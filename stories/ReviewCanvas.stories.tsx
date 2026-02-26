import React from 'react';
import { Story } from '@storybook/react';
import ReviewCanvas from '../src/components/ReviewCanvas';

export default {
  title: 'Components/ReviewCanvas',
  component: ReviewCanvas,
};

const Template: Story<React.ComponentProps<typeof ReviewCanvas>> = (args) => <ReviewCanvas {...args} />;

export const Default = Template.bind({});
Default.args = {
  code: `function helloWorld() {
  console.log("Hello, World!");
}`,
  language: 'javascript',
};
