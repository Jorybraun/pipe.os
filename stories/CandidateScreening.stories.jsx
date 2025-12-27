import React from 'react';
import CandidateScreeningView from '../prototypes/candidate-screening';

export default {
  title: 'Prototypes/Candidate Screening',
  component: CandidateScreeningView,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => (
  <div style={{ height: '100vh' }}>
    <CandidateScreeningView />
  </div>
);
