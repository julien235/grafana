import { EvalFunction } from 'app/features/alerting/state/alertDef';

import { ClassicCondition } from '../types';

import { getUnloadEvaluatorTypeFromCondition, isInvalid, updateEvaluatorConditions } from './Threshold';

describe('getUnloadEvaluatorTypeFromCondition', () => {
  it('should return IsBelow when given IsAbove', () => {
    const condition: ClassicCondition = {
      evaluator: {
        type: EvalFunction.IsAbove,
        params: [10],
      },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };

    expect(getUnloadEvaluatorTypeFromCondition(condition)).toBe(EvalFunction.IsBelow);
  });

  it('should return IsAbove when given IsBelow', () => {
    const condition: ClassicCondition = {
      evaluator: {
        type: EvalFunction.IsBelow,
        params: [10],
      },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };

    expect(getUnloadEvaluatorTypeFromCondition(condition)).toBe(EvalFunction.IsAbove);
  });

  it('should return IsOutsideRange when given IsWithinRange', () => {
    const condition: ClassicCondition = {
      evaluator: {
        type: EvalFunction.IsWithinRange,
        params: [10, 20],
      },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };

    expect(getUnloadEvaluatorTypeFromCondition(condition)).toBe(EvalFunction.IsOutsideRange);
  });

  it('should return IsWithinRange when given IsOutsideRange', () => {
    const condition: ClassicCondition = {
      evaluator: {
        type: EvalFunction.IsOutsideRange,
        params: [10, 20],
      },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };

    expect(getUnloadEvaluatorTypeFromCondition(condition)).toBe(EvalFunction.IsWithinRange);
  });
});

describe('isInvalid', () => {
  it('returns an error message if unloadEvaluator.params[0] is undefined', () => {
    const condition: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsAbove,
        params: [],
      },
      evaluator: { type: EvalFunction.IsAbove, params: [10] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition)).toEqual({ errorMsg: 'This value cannot be empty' });
  });

  it('When using is above, returns an error message if the value in unloadevaluator is above the threshold', () => {
    const condition: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsAbove,
        params: [15],
      },
      evaluator: { type: EvalFunction.IsAbove, params: [10] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition)).toEqual({ errorMsg: 'Enter a number less than or equal to 10' });
  });

  it('When using is below, returns an error message if the value in unloadevaluator is below the threshold', () => {
    const condition: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsAbove,
        params: [9],
      },
      evaluator: { type: EvalFunction.IsBelow, params: [10] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition)).toEqual({ errorMsg: 'Enter a number more than or equal to 10' });
  });

  it('When using is within range, returns an error message if the value in unloadevaluator is within the range', () => {
    // first parameter is wrong
    const condition: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsOutsideRange,
        params: [11, 21],
      },
      evaluator: { type: EvalFunction.IsWithinRange, params: [10, 20] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition)).toEqual({ errorMsgFrom: 'Enter a number less than or equal to 10' });
    // second parameter is wrong
    const condition2: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsOutsideRange,
        params: [9, 19],
      },
      evaluator: { type: EvalFunction.IsWithinRange, params: [10, 20] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition2)).toEqual({ errorMsgTo: 'Enter a number be more than or equal to 20' });
  });
  it('When using is outside range, returns an error message if the value in unloadevaluator is outside the range', () => {
    // first parameter is wrong
    const condition: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsWithinRange,
        params: [8, 19],
      },
      evaluator: { type: EvalFunction.IsOutsideRange, params: [10, 20] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition)).toEqual({ errorMsgFrom: 'Enter a number more than or equal to 10' });
    // second parameter is wrong
    const condition2: ClassicCondition = {
      unloadEvaluator: {
        type: EvalFunction.IsWithinRange,
        params: [11, 21],
      },
      evaluator: { type: EvalFunction.IsOutsideRange, params: [10, 20] },
      query: { params: ['A', 'B'] },
      reducer: { type: 'avg', params: [] },
      type: 'query',
    };
    expect(isInvalid(condition2)).toEqual({ errorMsgTo: 'Enter a number less than or equal to 20' });
  });
});

describe('updateEvaluatorConditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update only the evaluator when type is not changed', () => {
    const conditions: ClassicCondition[] = [
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [1, 2],
        },
        unloadEvaluator: {
          type: EvalFunction.IsBelow,
          params: [3, 4],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ];
    const update = {
      params: [5, 6],
    };
    const onError = jest.fn();

    const result = updateEvaluatorConditions(conditions, update, onError);

    expect(result).toEqual([
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [5, 6],
        },
        unloadEvaluator: {
          type: EvalFunction.IsBelow,
          params: [3, 4],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('should update only the evaluator when type is not changed and unload evaluator is not defined', () => {
    const conditions: ClassicCondition[] = [
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [1, 2],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ];
    const update = {
      params: [5, 6],
    };
    const onError = jest.fn();

    const result = updateEvaluatorConditions(conditions, update, onError);

    expect(result).toEqual([
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [5, 6],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('should update the evaluator when type is changed and hysteresis is not checked', () => {
    const conditions: ClassicCondition[] = [
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [1, 2],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ];
    const update = {
      type: EvalFunction.IsBelow,
      params: [5, 6],
    };
    const onError = jest.fn();

    const result = updateEvaluatorConditions(conditions, update, onError);

    expect(result).toEqual([
      {
        evaluator: {
          type: EvalFunction.IsBelow,
          params: [5, 6],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should update the unload evaluator when type is changed and hysteresis is checked', () => {
    const conditions: ClassicCondition[] = [
      {
        evaluator: {
          type: EvalFunction.IsAbove,
          params: [1],
        },
        unloadEvaluator: {
          type: EvalFunction.IsBelow,
          params: [0],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ];
    const update = {
      type: EvalFunction.IsBelow,
      params: [1],
    };
    const onError = jest.fn();

    const result = updateEvaluatorConditions(conditions, update, onError);

    expect(result).toEqual([
      {
        evaluator: {
          type: EvalFunction.IsBelow,
          params: [1],
        },
        unloadEvaluator: {
          type: EvalFunction.IsAbove,
          params: [1],
        },
        query: { params: ['A', 'B'] },
        reducer: { type: 'avg', params: [] },
        type: 'query',
      },
    ]);
    // we set the call on error but with undefined
    expect(onError).toHaveBeenCalledWith(undefined);
  });
});