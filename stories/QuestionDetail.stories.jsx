import QuestionDetail from '../prototypes/question-detail-prototype';

export default {
  title: 'Prototypes/QuestionDetail',
  component: QuestionDetail,
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
  render: () => <QuestionDetail />,
};
