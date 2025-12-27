import StageDetail from '../prototypes/stage-detail';

export default {
  title: 'Prototypes/StageDetail',
  component: StageDetail,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0a0a0f' },
      ],
    },
  },
};

export const Default = {
  render: () => <StageDetail />,
};
