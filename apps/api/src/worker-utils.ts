export const singleFlight = (
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): (() => Promise<void>) => {
  let inFlight: Promise<void> | null = null;

  return () => {
    if (inFlight) return inFlight;

    inFlight = task()
      .catch(onError)
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
};
