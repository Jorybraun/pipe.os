import RoleDiscoveryPhase from '../prototypes/role-discovery-stage.jsx';

export default {
  title: 'Prototypes/RoleDiscoveryStage',
  component: RoleDiscoveryPhase,
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
  render: () => <RoleDiscoveryPhase />,
};
