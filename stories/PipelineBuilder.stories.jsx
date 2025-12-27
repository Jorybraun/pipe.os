import React from 'react';
import PipelineBuilder from '../prototypes/pipeline-builder';

export default {
  title: 'Prototypes/Pipeline Builder',
  component: PipelineBuilder,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => (
  <div style={{ height: '100vh' }}>
    <PipelineBuilder />
  </div>
);
