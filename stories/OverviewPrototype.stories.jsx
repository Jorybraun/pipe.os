import React from 'react';
import PipelineDashboard from '../prototypes/overview-prototype';

export default {
  title: 'Prototypes/Overview',
  component: PipelineDashboard,
};

export const Default = () => (
  <div style={{ height: '100vh' }}>
    <PipelineDashboard />
  </div>
);
