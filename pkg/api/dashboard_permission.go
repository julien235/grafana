package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana/pkg/api/dtos"
	"github.com/grafana/grafana/pkg/api/response"
	"github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/auth/identity"
	contextmodel "github.com/grafana/grafana/pkg/services/contexthandler/model"
	"github.com/grafana/grafana/pkg/services/dashboards"
	"github.com/grafana/grafana/pkg/services/org"
	"github.com/grafana/grafana/pkg/web"
)

// swagger:route GET /dashboards/uid/{uid}/permissions dashboard_permissions getDashboardPermissionsListByUID
//
// Gets all existing permissions for the given dashboard.
//
// Responses:
// 200: getDashboardPermissionsListResponse
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError

// swagger:route GET /dashboards/id/{DashboardID}/permissions dashboard_permissions getDashboardPermissionsListByID
//
// Gets all existing permissions for the given dashboard.
//
// Please refer to [updated API](#/dashboard_permissions/getDashboardPermissionsListByUID) instead
//
// Deprecated: true
//
// Responses:
// 200: getDashboardPermissionsListResponse
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError
func (hs *HTTPServer) GetDashboardPermissionList(c *contextmodel.ReqContext) response.Response {
	var dashID int64
	var err error
	dashUID := web.Params(c.Req)[":uid"]
	if dashUID == "" {
		dashID, err = strconv.ParseInt(web.Params(c.Req)[":dashboardId"], 10, 64)
		if err != nil {
			return response.Error(http.StatusBadRequest, "dashboardId is invalid", err)
		}
	}

	dash, rsp := hs.getDashboardHelper(c.Req.Context(), c.SignedInUser.GetOrgID(), dashID, dashUID)
	if rsp != nil {
		return rsp
	}

	acl, err := hs.getDashboardACL(c.Req.Context(), c.SignedInUser, dash)
	if err != nil {
		return response.Error(500, "Failed to get dashboard permissions", err)
	}

	filteredACLs := make([]*dashboards.DashboardACLInfoDTO, 0, len(acl))
	for _, perm := range acl {
		if perm.UserID > 0 && dtos.IsHiddenUser(perm.UserLogin, c.SignedInUser, hs.Cfg) {
			continue
		}

		perm.UserAvatarURL = dtos.GetGravatarUrl(perm.UserEmail)

		if perm.TeamID > 0 {
			perm.TeamAvatarURL = dtos.GetGravatarUrlWithDefault(perm.TeamEmail, perm.Team)
		}
		if perm.Slug != "" {
			perm.URL = dashboards.GetDashboardFolderURL(perm.IsFolder, perm.UID, perm.Slug)
		}

		filteredACLs = append(filteredACLs, perm)
	}

	return response.JSON(http.StatusOK, filteredACLs)
}

// swagger:route POST /dashboards/uid/{uid}/permissions dashboard_permissions updateDashboardPermissionsByUID
//
// Updates permissions for a dashboard.
//
// This operation will remove existing permissions if they’re not included in the request.
//
// Responses:
// 200: okResponse
// 400: badRequestError
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError

// swagger:route POST /dashboards/id/{DashboardID}/permissions dashboard_permissions updateDashboardPermissionsByID
//
// Updates permissions for a dashboard.
//
// Please refer to [updated API](#/dashboard_permissions/updateDashboardPermissionsByUID) instead
//
// This operation will remove existing permissions if they’re not included in the request.
//
// Deprecated: true
//
// Responses:
// 200: okResponse
// 400: badRequestError
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError
func (hs *HTTPServer) UpdateDashboardPermissions(c *contextmodel.ReqContext) response.Response {
	var dashID int64
	var err error
	apiCmd := dtos.UpdateDashboardACLCommand{}
	if err := web.Bind(c.Req, &apiCmd); err != nil {
		return response.Error(http.StatusBadRequest, "bad request data", err)
	}
	if err := validatePermissionsUpdate(apiCmd); err != nil {
		return response.Error(400, err.Error(), err)
	}

	dashUID := web.Params(c.Req)[":uid"]
	if dashUID == "" {
		dashID, err = strconv.ParseInt(web.Params(c.Req)[":dashboardId"], 10, 64)
		if err != nil {
			return response.Error(http.StatusBadRequest, "dashboardId is invalid", err)
		}
	}

	dash, rsp := hs.getDashboardHelper(c.Req.Context(), c.SignedInUser.GetOrgID(), dashID, dashUID)
	if rsp != nil {
		return rsp
	}

	items := make([]*dashboards.DashboardACL, 0, len(apiCmd.Items))
	for _, item := range apiCmd.Items {
		items = append(items, &dashboards.DashboardACL{
			OrgID:       c.SignedInUser.GetOrgID(),
			DashboardID: dashID,
			UserID:      item.UserID,
			TeamID:      item.TeamID,
			Role:        item.Role,
			Permission:  item.Permission,
			Created:     time.Now(),
			Updated:     time.Now(),
		})
	}

	acl, err := hs.getDashboardACL(c.Req.Context(), c.SignedInUser, dash)
	if err != nil {
		return response.Error(http.StatusInternalServerError, "Error while checking dashboard permissions", err)
	}

	items = append(items, hs.filterHiddenACL(c.SignedInUser, acl)...)

	if err := hs.updateDashboardAccessControl(c.Req.Context(), dash.OrgID, dash.UID, false, items, acl); err != nil {
		return response.Error(http.StatusInternalServerError, "Failed to update permissions", err)
	}

	return response.Success("Dashboard permissions updated")
}

var dashboardPermissionMap = map[string]dashboards.PermissionType{
	"View":  dashboards.PERMISSION_VIEW,
	"Edit":  dashboards.PERMISSION_EDIT,
	"Admin": dashboards.PERMISSION_ADMIN,
}

func (hs *HTTPServer) getDashboardACL(ctx context.Context, user identity.Requester, dashboard *dashboards.Dashboard) ([]*dashboards.DashboardACLInfoDTO, error) {
	permissions, err := hs.dashboardPermissionsService.GetPermissions(ctx, user, dashboard.UID)
	if err != nil {
		return nil, err
	}

	acl := make([]*dashboards.DashboardACLInfoDTO, 0, len(permissions))
	for _, p := range permissions {
		if !p.IsManaged {
			continue
		}

		var role *org.RoleType
		if p.BuiltInRole != "" {
			tmp := org.RoleType(p.BuiltInRole)
			role = &tmp
		}

		permission := dashboardPermissionMap[hs.dashboardPermissionsService.MapActions(p)]

		acl = append(acl, &dashboards.DashboardACLInfoDTO{
			OrgID:          dashboard.OrgID,
			DashboardID:    dashboard.ID,
			FolderID:       dashboard.FolderID, // nolint:staticcheck
			Created:        p.Created,
			Updated:        p.Updated,
			UserID:         p.UserId,
			UserLogin:      p.UserLogin,
			UserEmail:      p.UserEmail,
			TeamID:         p.TeamId,
			TeamEmail:      p.TeamEmail,
			Team:           p.Team,
			Role:           role,
			Permission:     permission,
			PermissionName: permission.String(),
			UID:            dashboard.UID,
			Title:          dashboard.Title,
			Slug:           dashboard.Slug,
			IsFolder:       dashboard.IsFolder,
			URL:            dashboard.GetURL(),
			Inherited:      false,
		})
	}

	return acl, nil
}

func (hs *HTTPServer) filterHiddenACL(user identity.Requester, acl []*dashboards.DashboardACLInfoDTO) []*dashboards.DashboardACL {
	var hiddenACL []*dashboards.DashboardACL

	if user.GetIsGrafanaAdmin() {
		return hiddenACL
	}

	for _, item := range acl {
		if item.Inherited || item.UserLogin == user.GetLogin() {
			continue
		}

		if _, hidden := hs.Cfg.HiddenUsers[item.UserLogin]; hidden {
			hiddenACL = append(hiddenACL, &dashboards.DashboardACL{
				OrgID:       item.OrgID,
				DashboardID: item.DashboardID,
				UserID:      item.UserID,
				TeamID:      item.TeamID,
				Role:        item.Role,
				Permission:  item.Permission,
				Created:     item.Created,
				Updated:     item.Updated,
			})
		}
	}

	return hiddenACL
}

// updateDashboardAccessControl is used for api backward compatibility
func (hs *HTTPServer) updateDashboardAccessControl(ctx context.Context, orgID int64, uid string, isFolder bool, items []*dashboards.DashboardACL, old []*dashboards.DashboardACLInfoDTO) error {
	commands := []accesscontrol.SetResourcePermissionCommand{}
	for _, item := range items {
		permissions := item.Permission.String()
		role := ""
		if item.Role != nil {
			role = string(*item.Role)
		}

		commands = append(commands, accesscontrol.SetResourcePermissionCommand{
			UserID:      item.UserID,
			TeamID:      item.TeamID,
			BuiltinRole: role,
			Permission:  permissions,
		})
	}

	for _, o := range old {
		shouldRemove := true
		for _, item := range items {
			if item.UserID != 0 && item.UserID == o.UserID {
				shouldRemove = false
				break
			}
			if item.TeamID != 0 && item.TeamID == o.TeamID {
				shouldRemove = false
				break
			}
			if item.Role != nil && o.Role != nil && *item.Role == *o.Role {
				shouldRemove = false
				break
			}
		}
		if shouldRemove {
			role := ""
			if o.Role != nil {
				role = string(*o.Role)
			}

			commands = append(commands, accesscontrol.SetResourcePermissionCommand{
				UserID:      o.UserID,
				TeamID:      o.TeamID,
				BuiltinRole: role,
				Permission:  "",
			})
		}
	}

	if isFolder {
		if _, err := hs.folderPermissionsService.SetPermissions(ctx, orgID, uid, commands...); err != nil {
			return err
		}
		return nil
	}

	if _, err := hs.dashboardPermissionsService.SetPermissions(ctx, orgID, uid, commands...); err != nil {
		return err
	}
	return nil
}

func validatePermissionsUpdate(apiCmd dtos.UpdateDashboardACLCommand) error {
	for _, item := range apiCmd.Items {
		if item.UserID > 0 && item.TeamID > 0 {
			return dashboards.ErrPermissionsWithUserAndTeamNotAllowed
		}

		if (item.UserID > 0 || item.TeamID > 0) && item.Role != nil {
			return dashboards.ErrPermissionsWithRoleNotAllowed
		}
	}
	return nil
}

// swagger:parameters getDashboardPermissionsListByUID
type GetDashboardPermissionsListByUIDParams struct {
	// in:path
	// required:true
	UID string `json:"uid"`
}

// swagger:parameters getDashboardPermissionsListByID
type GetDashboardPermissionsListByIDParams struct {
	// in:path
	DashboardID int64
}

// swagger:parameters updateDashboardPermissionsByID
type UpdateDashboardPermissionsByIDParams struct {
	// in:body
	// required:true
	Body dtos.UpdateDashboardACLCommand
	// in:path
	DashboardID int64
}

// swagger:parameters updateDashboardPermissionsByUID
type UpdateDashboardPermissionsByUIDParams struct {
	// in:body
	// required:true
	Body dtos.UpdateDashboardACLCommand
	// in:path
	// required:true
	// description: The dashboard UID
	UID string `json:"uid"`
}

// swagger:response getDashboardPermissionsListResponse
type GetDashboardPermissionsResponse struct {
	// in: body
	Body []*dashboards.DashboardACLInfoDTO `json:"body"`
}
