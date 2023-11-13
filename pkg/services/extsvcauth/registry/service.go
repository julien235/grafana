package registry

import (
	"context"
	"errors"
	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/infra/serverlock"
	"github.com/grafana/grafana/pkg/services/extsvcauth"
	"github.com/grafana/grafana/pkg/services/extsvcauth/oauthserver"
	"github.com/grafana/grafana/pkg/services/featuremgmt"
	"github.com/grafana/grafana/pkg/services/serviceaccounts/extsvcaccounts"
	"time"
)

var _ extsvcauth.ExternalServiceRegistry = &Registry{}

const (
	saveTimeout = 1 * time.Minute
)

type Registry struct {
	features    featuremgmt.FeatureToggles
	logger      log.Logger
	oauthServer oauthserver.OAuth2Server
	saSvc       *extsvcaccounts.ExtSvcAccountsService
	lock        *serverlock.ServerLockService
}

func ProvideExtSvcRegistry(oauthServer oauthserver.OAuth2Server, saSvc *extsvcaccounts.ExtSvcAccountsService, features featuremgmt.FeatureToggles) *Registry {
	return &Registry{
		features:    features,
		logger:      log.New("extsvcauth.registry"),
		oauthServer: oauthServer,
		saSvc:       saSvc,
		// TODO xavi: Add serverLocker here
	}
}

// SaveExternalService creates or updates an external service in the database. Based on the requested auth provider,
// it generates client_id, secrets and any additional provider specificities (ex: rsa keys). It also ensures that the
// associated service account has the correct permissions.
func (r *Registry) SaveExternalService(ctx context.Context, cmd *extsvcauth.ExternalServiceRegistration) (*extsvcauth.ExternalService, error) {
	var extSvc *extsvcauth.ExternalService
	var errSave error

	// Server lock necessary to support HA setup. Only one server should seed the database concurrently.
	errLock := r.lock.LockExecuteAndRelease(ctx, "ext-svc-save-"+cmd.Name, saveTimeout, func(ctx context.Context) {
		switch cmd.AuthProvider {
		case extsvcauth.ServiceAccounts:
			if !r.features.IsEnabled(featuremgmt.FlagExternalServiceAccounts) {
				r.logger.Warn("Skipping external service authentication, flag disabled", "service", cmd.Name, "flag", featuremgmt.FlagExternalServiceAccounts)
				return
			}
			r.logger.Debug("Routing the External Service registration to the External Service Account service", "service", cmd.Name)
			// TODO xavi: If 2 Grafana instances try to create the same external service, there won't be data races thanks
			// to the new lock but, won't the last instance that tries to create the extsvc get an error that the SA already
			// exists here? If that's the case, is it OK?
			extSvc, errSave = r.saSvc.SaveExternalService(ctx, cmd)
		case extsvcauth.OAuth2Server:
			if !r.features.IsEnabled(featuremgmt.FlagExternalServiceAuth) {
				r.logger.Warn("Skipping external service authentication, flag disabled", "service", cmd.Name, "flag", featuremgmt.FlagExternalServiceAuth)
				return
			}
			r.logger.Debug("Routing the External Service registration to the OAuth2Server", "service", cmd.Name)
			extSvc, errSave = r.oauthServer.SaveExternalService(ctx, cmd)
		default:
			errSave = extsvcauth.ErrUnknownProvider.Errorf("unknown provider '%v'", cmd.AuthProvider)
		}
	})

	if errLock != nil {
		var lockedErr *serverlock.ServerLockExistsError
		if errors.As(errLock, &lockedErr) {
			// if the lock is already taken
			r.logger.Debug("Skipping external service authentication, could not acquire lock", "service", cmd.Name)

			// TODO xavi: If the lock was taken, do we need to retry? I don't think we'd need to do that during startup
			// if multiple instances are trying to save the same extSvc, as it'd be redundant. Not sure, however,
			// if in a HA setup this situation could happen at some point other than during startup. Assuming yes, then we should
			// probably retry?
		}

		// if the lock failed for another reason, return the error
		return nil, errLock
	}

	// lock was acquired and released successfully
	return extSvc, errSave
}
