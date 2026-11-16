export type Handler = (msg: any) => void;

export class NetClient {
  ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  onMessage(h: Handler): void {
    this.handlers.push(h);
  }
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('Connessione a ' + url + ' fallita'));
      this.ws.onclose = () => this.handlers.forEach((h) => h({ t: 'closed' }));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        this.handlers.forEach((h) => h(m));
      };
    });
  }
  send(m: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export const defaultWsUrl = (): string => {
  if (typeof location !== 'undefined' && location.port !== '5173' && location.host) return `ws://${location.host}`;
  return 'ws://127.0.0.1:3001';
};
