import { singleFlight } from '../src/worker-utils';

describe('worker reconciliation', () => {
  test('does not run overlapping reconciliation cycles', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const task = jest.fn(() => pending);
    const onError = jest.fn();
    const run = singleFlight(task, onError);

    const first = run();
    const second = run();

    expect(task).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    finish();
    await first;
    await run();

    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  test('reports an error and allows the next reconciliation cycle', async () => {
    const error = new Error('temporary database error');
    const task = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const onError = jest.fn();
    const run = singleFlight(task, onError);

    await expect(run()).resolves.toBeUndefined();
    await expect(run()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(error);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
