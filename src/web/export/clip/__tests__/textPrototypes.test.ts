import { describe, expect, test } from 'vitest';
import {
  parseTextLayerAddAttributes,
  parseTextLayerAttributes,
} from '../textTlv';
import { TEXT_LAYER_PROTOTYPES } from '../textPrototypes.gen';

describe('textPrototypes.gen', () => {
  test('exports L5/L6/L7 cache-less prototypes with parseable TLV blobs', () => {
    for (const mainId of [5, 6, 7] as const) {
      const template = TEXT_LAYER_PROTOTYPES.get(mainId);
      expect(template).toBeDefined();

      const attr = parseTextLayerAttributes(template!.blobs.attributes);
      const add = parseTextLayerAddAttributes(template!.blobs.addAttributes);
      expect(attr.entries.length).toBeGreaterThan(0);
      expect(add.entries.length).toBeGreaterThan(0);

      const id50 = attr.entries.find((e) => e.paramId === 50);
      expect(id50).toBeDefined();
      const cacheId = new DataView(id50!.payload.buffer, id50!.payload.byteOffset).getUint32(
        0,
        true,
      );
      expect(cacheId).toBe(0);
    }
  });

  test('base64 round-trip preserves TLV byte identity', () => {
    for (const mainId of [5, 6, 7] as const) {
      const template = TEXT_LAYER_PROTOTYPES.get(mainId)!;
      const attrB64 = Buffer.from(template.blobs.attributes).toString('base64');
      const addB64 = Buffer.from(template.blobs.addAttributes).toString('base64');
      const attrRestored = Uint8Array.from(Buffer.from(attrB64, 'base64'));
      const addRestored = Uint8Array.from(Buffer.from(addB64, 'base64'));

      expect(attrRestored).toEqual(template.blobs.attributes);
      expect(addRestored).toEqual(template.blobs.addAttributes);

      expect(parseTextLayerAttributes(attrRestored)).toEqual(
        parseTextLayerAttributes(template.blobs.attributes),
      );
      expect(parseTextLayerAddAttributes(addRestored)).toEqual(
        parseTextLayerAddAttributes(template.blobs.addAttributes),
      );
    }
  });
});
