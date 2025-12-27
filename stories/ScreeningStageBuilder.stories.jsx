import React from 'react';
import ScreeningStageBuilder from '../prototypes/screening-stage-builder';

export default {
  title: 'Prototypes/Screening Stage Builder',
  component: ScreeningStageBuilder,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => (
  <div style={{ height: '100vh' }}>
    <ScreeningStageBuilder />
  </div>
);
