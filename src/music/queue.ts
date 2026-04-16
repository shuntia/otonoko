import { Track } from "./manager.js";

export class Queue {
  private items: Track[] = [];
  private currentIndex: number = -1;

  enqueue(track: Track) {
    this.items.push(track);
  }

  enqueueMany(tracks: Track[]) {
    this.items.push(...tracks);
  }

  unshift(track: Track) {
    // If we unshift, we need to adjust currentIndex if it's >= 0
    this.items.unshift(track);
    if (this.currentIndex >= 0) {
      this.currentIndex++;
    }
  }

  // Returns the next track and advances the pointer
  next(): Track | undefined {
    if (this.currentIndex + 1 < this.items.length) {
      this.currentIndex++;
      return this.items[this.currentIndex];
    }
    return undefined;
  }

  // Returns the previous track and moves the pointer back
  previous(): Track | undefined {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.items[this.currentIndex];
    }
    return undefined;
  }

  // Returns the current track without moving pointer
  current(): Track | undefined {
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
      return this.items[this.currentIndex];
    }
    return undefined;
  }

  dequeue(): Track | undefined {
    return this.items.shift();
  }

  peek(): Track | undefined {
    if (this.currentIndex + 1 < this.items.length) {
      return this.items[this.currentIndex + 1];
    }
    return undefined;
  }

  remove(index: number): Track | undefined {
    if (index < 0 || index >= this.items.length) return undefined;
    const [removed] = this.items.splice(index, 1);
    // Adjust pointer if removing item before current index
    if (index <= this.currentIndex) {
      this.currentIndex--;
    }
    return removed;
  }

  replace(id: string, newTrack: Track): boolean {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.items[idx] = newTrack;
    return true;
  }

  move(from: number, to: number): boolean {
    if (from < 0 || from >= this.items.length) return false;
    if (to < 0 || to >= this.items.length) return false;
    
    // If moving the current track, update index
    const isCurrent = from === this.currentIndex;
    
    const [item] = this.items.splice(from, 1);
    this.items.splice(to, 0, item);
    
    if (isCurrent) {
      this.currentIndex = to;
    } else {
      // If we moved something from before to after
      if (from < this.currentIndex && to >= this.currentIndex) {
        this.currentIndex--;
      }
      // If we moved something from after to before
      else if (from > this.currentIndex && to <= this.currentIndex) {
        this.currentIndex++;
      }
    }
    return true;
  }

  shuffle() {
    // Shuffle everything AFTER currentIndex
    const start = this.currentIndex + 1;
    if (start >= this.items.length) return;

    for (let i = this.items.length - 1; i > start; i -= 1) {
      const j = Math.floor(Math.random() * (i - start + 1)) + start;
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }

  clear() {
    this.items = [];
    this.currentIndex = -1;
  }

  get length(): number {
    return this.items.length;
  }

  get all(): Track[] {
    return [...this.items];
  }
  
  get index(): number {
    return this.currentIndex;
  }
  
  set index(val: number) {
    this.currentIndex = val;
  }
}
