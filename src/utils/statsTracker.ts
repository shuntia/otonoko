import { Client } from "discord.js";
import os from "os";

interface SystemStats {
  currentPing: number;
  peakPing: number;
  currentLoad: number[];
  peakLoad: number; // Peak 1-minute load
  lastUpdated: Date;
}

class StatsTracker {
  private client: Client | null = null;
  private peakPing = -1;
  private peakLoad = -1;
  private interval: NodeJS.Timeout | null = null;

  public start(client: Client) {
    this.client = client;
    this.interval = setInterval(() => this.updateStats(), 5000);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private updateStats() {
    if (!this.client) return;

    const ping = this.client.ws.ping;
    if (ping > this.peakPing) {
      this.peakPing = ping;
    }

    const load = os.loadavg();
    if (load[0] > this.peakLoad) {
      this.peakLoad = load[0];
    }
  }

  public getStats(): SystemStats {
    return {
      currentPing: this.client?.ws.ping ?? -1,
      peakPing: this.peakPing,
      currentLoad: os.loadavg(),
      peakLoad: this.peakLoad,
      lastUpdated: new Date(),
    };
  }
}

export const statsTracker = new StatsTracker();
