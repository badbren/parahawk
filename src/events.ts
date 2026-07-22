import { EventEmitter } from "node:events";

export interface BlockFoundEvent {
  height: number;
  prevHeight: number;
  cycleDurationBlocks: number;
  estCyclePhd: number;
  poolHashratePhs: number;
  hashpriceSatsPerPhd: number;
}

export interface WatchAlertEvent {
  channelId: string;
  address: string;
  kind: "stuck" | "fulfilled";
  orderId: string;
  detail: string;
}

class Bus extends EventEmitter {
  emitBlockFound(e: BlockFoundEvent): void {
    this.emit("blockFound", e);
  }
  onBlockFound(fn: (e: BlockFoundEvent) => void): void {
    this.on("blockFound", fn);
  }
  emitWatchAlert(e: WatchAlertEvent): void {
    this.emit("watchAlert", e);
  }
  onWatchAlert(fn: (e: WatchAlertEvent) => void): void {
    this.on("watchAlert", fn);
  }
}

/** Process-wide event bus connecting pollers → Discord bot. */
export const bus = new Bus();
