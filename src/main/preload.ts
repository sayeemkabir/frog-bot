import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The only bridge between the UI and the engine. The UI never gets Node access.
contextBridge.exposeInMainWorld('frog', {
  platform: process.platform,
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('frog:call', method, args),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, event: unknown) => listener(event);
    ipcRenderer.on('frog:event', handler);
    return () => ipcRenderer.removeListener('frog:event', handler);
  },
  onFocusConversation: (listener: (conversationId: string) => void) => {
    const handler = (_e: IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('frog:focus-conversation', handler);
    return () => ipcRenderer.removeListener('frog:focus-conversation', handler);
  },
});
