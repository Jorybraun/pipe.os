/**
 * Quiz Questions for Phase 3 MVP.
 * Focused on TypeScript, JavaScript, and React.
 */

export interface QuizQuestion {
  id: string;
  q: string;
  options: string[];
  correct: number; // Index of the correct option
}

export const quizQuestions: QuizQuestion[] = [
  {
    id: 'js-equality',
    q: "What is the result of `[] == ![]` in JavaScript?",
    options: [
      "true",
      "false",
      "undefined",
      "TypeError"
    ],
    correct: 0
  },
  {
    id: 'react-lifecycle',
    q: "In a React functional component, which hook is used to perform side effects?",
    options: [
      "useState",
      "useContext",
      "useEffect",
      "useReducer"
    ],
    correct: 2
  },
  {
    id: 'ts-interfaces',
    q: "In TypeScript, what is the primary difference between an interface and a type alias?",
    options: [
      "Interfaces can be extended, type aliases cannot",
      "Type aliases can be extended, interfaces cannot",
      "Interfaces support declaration merging, type aliases do not",
      "There is no difference"
    ],
    correct: 2
  },
  {
    id: 'js-closure',
    q: "What is a closure in JavaScript?",
    options: [
      "A function combined with its lexical environment",
      "A way to close a database connection",
      "A method to terminate a loop",
      "A private variable in a class"
    ],
    correct: 0
  },
  {
    id: 'react-keys',
    q: "Why are 'keys' important when rendering lists in React?",
    options: [
      "They uniquely identify an element among its siblings",
      "They improve the styling of the elements",
      "They are required for accessibility",
      "They speed up initial rendering"
    ],
    correct: 0
  },
  {
    id: 'js-event-loop',
    q: "What is the primary role of the JavaScript Event Loop?",
    options: [
      "To execute all code in a single thread simultaneously",
      "To handle asynchronous callbacks by moving them to the call stack",
      "To manage memory allocation for objects",
      "To compile JavaScript into machine code"
    ],
    correct: 1
  },
  {
    id: 'ts-generics',
    q: "Which symbol is used to define a Generic in TypeScript?",
    options: [
      "( )",
      "[ ]",
      "{ }",
      "< >"
    ],
    correct: 3
  },
  {
    id: 'react-refs',
    q: "What is the primary use case for `useRef` in React?",
    options: [
      "To store a value that triggers a re-render when changed",
      "To access DOM elements directly",
      "To share state between multiple components",
      "To memoize expensive calculations"
    ],
    correct: 1
  },
  {
    id: 'js-hoisting',
    q: "Which of the following is NOT hoisted in JavaScript?",
    options: [
      "Function declarations",
      "var variables",
      "let and const variables",
      "They are all hoisted"
    ],
    correct: 2
  },
  {
    id: 'react-memo',
    q: "What does `React.memo` do?",
    options: [
      "Automatically saves component state to localStorage",
      "Prevents a component from re-rendering if its props haven't changed",
      "Speeds up the initial mount of a component",
      "Provides a way to memoize heavy functions inside a component"
    ],
    correct: 1
  }
];
