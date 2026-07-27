import type { RootSettings } from '../storage/database';
import type { DispatchResult } from '../business/dispatcher';

declare global {
  interface Window {
    terminal: {
      version: string;
      settings: {
        chooseRoot(): Promise<string | undefined>;
        initializeRoot(rootPath: string): Promise<RootSettings>;
        get(): Promise<RootSettings | undefined>;
      };
      business: {
        dispatch(name: string, input: unknown): Promise<DispatchResult>;
      };
      lifecycle: {
        quit(): Promise<void>;
        closeWindow(): Promise<void>;
        reopenWindow(): Promise<void>;
      };
      system: {
        openPath(filePath: string): Promise<string>;
        openExternal(url: string): Promise<void>;
        copyText(text: string): Promise<void>;
        imageData(filePath: string): Promise<string>;
        capturePage(filePath: string): Promise<string>;
      };
      browser: {
        create(url?: string): Promise<{ id: string; url: string; title: string; status: string }>;
        activate(id: string): Promise<unknown>;
        navigate(id: string, url: string): Promise<unknown>;
        back(id: string): Promise<void>;
        forward(id: string): Promise<void>;
        reload(id: string): Promise<void>;
        find(id: string, text: string): Promise<unknown>;
        visible(visible: boolean): Promise<void>;
      };
    };
  }
}

export {};
