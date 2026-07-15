/**
 * SmoothStreamer manages a character-by-character animation queue to deliver
 * a calm, natural writing rhythm for AI responses.
 *
 * It prevents instant "dumps" of text from WebSockets and instead flows
 * the output smoothly like a real typing experience.
 */
export class SmoothStreamer {
  private queue: string[] = [];
  private currentText = "";
  private intervalId: number | null = null;
  private onUpdate: (text: string) => void;
  private onComplete: () => void;
  private isFinishedStreaming = false;

  // Adaptive typing delay (ms per character)
  private minDelay = 6;    // Fastest typing when queue is full
  private maxDelay = 18;   // Natural, calm typing speed

  constructor(onUpdate: (text: string) => void, onComplete: () => void) {
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
  }

  /**
   * Appends a chunk of text to the typing queue.
   */
  public enqueue(chunk: string) {
    // Split into individual characters for maximum smooth flow
    for (const char of chunk) {
      this.queue.push(char);
    }

    if (!this.intervalId) {
      this.startLoop();
    }
  }

  /**
   * Signals that the backend stream has finished.
   * The streamer will complete once the queue is fully typed out.
   */
  public finish() {
    this.isFinishedStreaming = true;
    if (this.queue.length === 0) {
      this.stop();
    }
  }

  /**
   * Instantly stops any running loop.
   */
  public destroy() {
    if (this.intervalId) {
      window.clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private startLoop() {
    const tick = () => {
      if (this.queue.length === 0) {
        if (this.isFinishedStreaming) {
          this.stop();
        } else {
          // Pause loop until more chunks arrive
          this.intervalId = null;
        }
        return;
      }

      // Adaptive speed: if the queue is growing large, type faster to catch up.
      // Otherwise, maintain a calm, natural reading speed.
      const charsToTake = this.queue.length > 80 ? 3 : this.queue.length > 30 ? 2 : 1;
      let nextChars = "";
      for (let i = 0; i < charsToTake; i++) {
        const char = this.queue.shift();
        if (char !== undefined) {
          nextChars += char;
        }
      }

      this.currentText += nextChars;
      this.onUpdate(this.currentText);

      const delay = this.queue.length > 50 ? this.minDelay : this.maxDelay;
      this.intervalId = window.setTimeout(tick, delay);
    };

    this.intervalId = window.setTimeout(tick, this.maxDelay);
  }

  private stop() {
    this.destroy();
    this.onComplete();
  }
}
