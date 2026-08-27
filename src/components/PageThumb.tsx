import { Image, StyleSheet, View } from 'react-native';

import { InkLayer } from './InkLayer';
import { TEMPLATE_PAGE_NUMBER_COVER, type Page } from '../domain/types';

type PageThumbProps = {
  page: Page | undefined;
  width: number;
  height: number;
};

export function PageThumb({ page, width, height }: PageThumbProps) {
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#fff' }}>
      <Image source={require('../../sample/page_template.jpg')} style={styles.template} />
      <View
        pointerEvents="none"
        style={[
          styles.coverNumber,
          {
            left: `${TEMPLATE_PAGE_NUMBER_COVER.x * 100}%`,
            top: `${TEMPLATE_PAGE_NUMBER_COVER.y * 100}%`,
            width: `${TEMPLATE_PAGE_NUMBER_COVER.width * 100}%`,
            height: `${TEMPLATE_PAGE_NUMBER_COVER.height * 100}%`,
          },
        ]}
      />
      {page ? <InkLayer raster={page.raster} width={width} height={height} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  template: {
    width: '100%',
    height: '100%',
  },
  coverNumber: {
    position: 'absolute',
    backgroundColor: '#fff',
  },
});
