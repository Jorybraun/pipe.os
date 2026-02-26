import React from 'react';
import { Story } from '@storybook/react';
import QuizRenderer from '../src/components/QuizRenderer';

export default {
  title: 'Components/QuizRenderer',
  component: QuizRenderer,
};

const Template: Story<React.ComponentProps<typeof QuizRenderer>> = (args) => <QuizRenderer {...args} />;

export const Default = Template.bind({});
Default.args = {
  questions: [
    {
      id: '1',
      text: 'What is the capital of France?',
      options: ['Paris', 'London', 'Berlin', 'Rome'],
    },
    {
      id: '2',
      text: 'What is the highest mountain in the world?',
      options: ['Mount Everest', 'K2', 'Kangchenjunga', 'Lhotse'],
    },
  ],
  onAnswer: (questionId, answer) => {
    console.log(`Answered question ${questionId} with ${answer}`)
  },
  onNext: () => console.log('Next question'),
  onPrev: () => console.log('Previous question'),
  currentQuestionIndex: 0,
};
