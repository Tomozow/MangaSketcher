import { Text, TextInput, View } from 'react-native';

import { verticalGlyphs } from '../domain/text';

type VerticalTextProps = {
  content: string;
  color: string;
  fontSize: number;
  editable?: boolean;
  onChangeText?: (text: string) => void;
  accessibilityLabel?: string;
};

export function VerticalText({
  content,
  color,
  fontSize,
  editable = false,
  onChangeText,
  accessibilityLabel,
}: VerticalTextProps) {
  const glyphs = verticalGlyphs(content);
  const size = Math.max(8, fontSize);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}>
      {glyphs.map((glyph, index) => (
        <Text key={`${index}-${glyph}`} style={{ color, fontSize: size, lineHeight: size + 2 }}>
          {glyph}
        </Text>
      ))}
      {editable ? (
        <TextInput
          accessibilityLabel={accessibilityLabel ?? 'テキスト本文'}
          value={content}
          onChangeText={onChangeText}
          placeholder="本文"
          placeholderTextColor="#A89F93"
          multiline
          textAlign="center"
          autoCorrect={false}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            color,
            fontSize: size,
            textAlignVertical: 'top',
            padding: 0,
            backgroundColor: glyphs.length === 0 ? 'transparent' : 'transparent',
            opacity: glyphs.length === 0 ? 1 : 0.02,
          }}
        />
      ) : null}
    </View>
  );
}
