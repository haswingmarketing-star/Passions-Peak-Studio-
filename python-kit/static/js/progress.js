/** SSE progress listener for the standalone Python Creator Kit UI. */
window.subscribeJobProgress = function subscribeJobProgress(jobId, onUpdate) {
  const src = new EventSource(`/api/progress/${encodeURIComponent(jobId)}`);
  src.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      onUpdate(payload);
      if (payload.status === "completed" || payload.status === "failed") {
        src.close();
      }
    } catch (err) {
      console.error("Failed to parse SSE frame", err);
    }
  };
  src.onerror = () => {
    src.close();
  };
  return src;
};
