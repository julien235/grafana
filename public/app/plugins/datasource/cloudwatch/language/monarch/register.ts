import type * as monacoType from 'monaco-editor/esm/vs/editor/editor.api';

import { Monaco } from '@grafana/ui';

import { Completeable } from './types';

export type LanguageDefinition = {
  id: string;
  extensions: string[];
  aliases: string[];
  mimetypes: string[];
  loader: () => Promise<{
    language: monacoType.languages.IMonarchLanguage;
    conf: monacoType.languages.LanguageConfiguration;
  }>;
};

export const registerLanguage = async (
  monaco: Monaco,
  language: LanguageDefinition,
  completionItemProvider: Completeable,
  disposal?: monacoType.IDisposable
) => {
  const { id, loader } = language;

  if (!disposal) {
    const languages = monaco.languages.getLanguages();
    if (languages.find((l) => l.id === id)) {
      return;
    }
  }

  console.log('disposal set', disposal !== undefined);
  disposal?.dispose();
  monaco.languages.register({ id });
  return loader().then((monarch) => {
    monaco.languages.setMonarchTokensProvider(id, monarch.language);
    monaco.languages.setLanguageConfiguration(id, monarch.conf);
    return monaco.languages.registerCompletionItemProvider(
      id,
      completionItemProvider.getCompletionProvider(monaco, language)
    );
  });
};
