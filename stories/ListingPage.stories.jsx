import React from 'react';
import RolesListing from '../prototypes/listing-page';

export default {
  title: 'Prototypes/Listing Page',
  component: RolesListing,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => (
  <div style={{ height: '100vh' }}>
    <RolesListing />
  </div>
);
