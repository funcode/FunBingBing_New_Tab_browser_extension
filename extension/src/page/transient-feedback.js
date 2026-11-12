export function createTransientFeedback(window, update) {
  let timer;
  let disposed = false;

  return {
    show(text = '') {
      if (disposed) return;
      window.clearTimeout(timer);
      timer = undefined;
      update(text);
      if (text) {
        timer = window.setTimeout(() => {
          timer = undefined;
          update('');
        }, 8_000);
      }
    },
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
    }
  };
}
