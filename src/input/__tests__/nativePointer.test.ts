import {
  createPointerKindTracker,
  pdfPointerPolicy,
  pointerKindFromNative,
  pressureFromNative,
  stockPointerPolicy,
  workspacePointerPolicy,
} from '../nativePointer';

describe('iPad ポインタ判定', () => {
  test('RNGH pointerType で Pencil と指が分かれる', () => {
    expect(pointerKindFromNative({ pointerType: 1 })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 0 })).toBe('finger');
    expect(pointerKindFromNative({ pointerType: 2 })).toBe('finger');
    expect(pointerKindFromNative({ pointerType: 'pen' })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 'pencil' })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 'stylus' })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 'touch' })).toBe('finger');
  });

  test('stylusData があれば Pencil、W3C 文字列も Pencil', () => {
    expect(
      pointerKindFromNative({
        stylusData: { altitudeAngle: 1.2, pressure: 0.4 },
      }),
    ).toBe('pencil');
    expect(pointerKindFromNative({ type: 'stylus' })).toBe('pencil');
  });

  test('UIKit touchType の Pencil は 2（1 は Indirect なので指）', () => {
    expect(pointerKindFromNative({ touchType: 2 })).toBe('pencil');
    expect(pointerKindFromNative({ touchType: 1 })).toBe('finger');
    expect(pointerKindFromNative({ touchType: 0 })).toBe('finger');
    expect(pointerKindFromNative({ type: 'touchstart' })).toBe('finger');
  });

  test('force だけでは Pencil にしない（弱いペンを指扱いにしない／指の誤爆を防ぐ）', () => {
    expect(pointerKindFromNative({ pointerType: 'touch', force: 0.9 })).toBe('finger');
    expect(pointerKindFromNative({ pointerType: 'pen', force: 0 })).toBe('pencil');
    expect(pointerKindFromNative({ pointerType: 0, force: 0.9 })).toBe('finger');
    expect(pointerKindFromNative({ force: 0.8 })).toBe('finger');
  });

  test('筆圧は stylusData.pressure を優先する', () => {
    expect(pressureFromNative({ stylusData: { pressure: 0.5 } })).toBe(0.5);
    expect(pressureFromNative({ pointerType: 1, stylusData: { pressure: 0 } })).toBe(1);
  });

  test('同一 id の sticky 判定', () => {
    const tracker = createPointerKindTracker();
    expect(tracker.classify({ identifier: 7, pointerType: 1, force: 0 })).toBe('pencil');
    expect(tracker.classify({ identifier: 7 })).toBe('pencil');
    tracker.release({ identifier: 7 });
    expect(tracker.classify({ identifier: 7, pointerType: 0 })).toBe('finger');
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
