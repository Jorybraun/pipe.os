import QuestionDetailPrototype from '../prototypes/question-detail-component-prototype';

export default {
  title: 'Prototypes/QuestionDetailComponentPrototype',
  component: QuestionDetailPrototype,
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
  render: () => <QuestionDetailPrototype />,
};
