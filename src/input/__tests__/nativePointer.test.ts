import {
  createPointerKindTracker,
  pdfPointerPolicy,
  pointerKindFromNative,
  stockPointerPolicy,
  workspacePointerPolicy,
} from '../nativePointer';

describe('iPad ポインタ判定', () => {
  test('pointerType / touchType で Pencil と指が分かれる', () => {
    expect(pointerKindFromNative({ pointerType: 'pen' })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 'pencil' })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 'touch' })).toBe('finger');
    expect(pointerKindFromNative({ type: 'touchstart' })).toBe('finger');
    expect(pointerKindFromNative({ touchType: 1 })).toBe('pencil');
    expect(pointerKindFromNative({ touchType: 0 })).toBe('finger');
    expect(pointerKindFromNative({ type: 'stylus' })).toBe('pencil');
  });

  test('force だけでは Pencil にしない（弱いペンを指扱いにしない／指の誤爆を防ぐ）', () => {
    expect(pointerKindFromNative({ pointerType: 'touch', force: 0.9 })).toBe('finger');
    expect(pointerKindFromNative({ pointerType: 'pen', force: 0 })).toBe('pencil');
    expect(pointerKindFromNative({ force: 0.8 })).toBe('finger');
  });

  test('altitude がある Pencil と、同一 id の sticky 判定', () => {
    expect(pointerKindFromNative({ altitudeAngle: 1.2 })).toBe('pencil');
    const tracker = createPointerKindTracker();
    expect(tracker.classify({ identifier: 7, pointerType: 'pen', force: 0 })).toBe('pencil');
    expect(tracker.classify({ identifier: 7 })).toBe('pencil');
    tracker.release({ identifier: 7 });
    expect(tracker.classify({ identifier: 7, pointerType: 'touch' })).toBe('finger');
  });

  test('ワークスペース／PDF／ストックのポリシーが指と Pencil で分岐する', () => {
    expect(workspacePointerPolicy('finger')).toMatchObject({
      pan: true,
      grabPage: true,
      ink: false,
      marquee: false,
    });
    expect(workspacePointerPolicy('pencil')).toMatchObject({
      pan: false,
      grabPage: false,
      ink: true,
      marquee: true,
      text: true,
    });
    expect(pdfPointerPolicy('finger').rangeSelect).toBe(true);
    expect(pdfPointerPolicy('pencil').rangeSelect).toBe(false);
    expect(stockPointerPolicy('finger')).toEqual({ pan: true, dragPage: true });
    expect(stockPointerPolicy('pencil')).toEqual({ pan: false, dragPage: false });
  });
});
