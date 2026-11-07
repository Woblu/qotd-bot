// The /qotd slash command, in Discord's format. `npm run deploy` registers it in the staff server.
const SUB_COMMAND = 1;
const INTEGER = 4;
const USER = 6;

const userOption = (description) => ({ type: USER, name: 'user', description, required: true });

export const commands = [
  {
    name: 'qotd',
    description: 'Question of the Day rotation',
    options: [
      {
        type: SUB_COMMAND,
        name: 'template',
        description: "Show today's QOTD template with the question number filled in",
        options: [{ type: INTEGER, name: 'number', description: 'Use a different question number', min_value: 1 }],
      },
      { type: SUB_COMMAND, name: 'schedule', description: "See whose turn is coming up and the rotation order" },
      { type: SUB_COMMAND, name: 'skip', description: "Pass today's turn to the next person in line" },
      {
        type: SUB_COMMAND,
        name: 'add',
        description: '[Manager] Add a staff member to the rotation',
        options: [
          userOption('Staff member to add'),
          { type: INTEGER, name: 'position', description: 'Spot in the rotation (1 = first). Default: the end', min_value: 1 },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'remove',
        description: '[Manager] Remove a staff member from the rotation',
        options: [userOption('Staff member to remove')],
      },
      {
        type: SUB_COMMAND,
        name: 'set-next',
        description: '[Manager] Choose who gets the next turn (the rotation continues from them)',
        options: [userOption('Staff member who goes next')],
      },
      {
        type: SUB_COMMAND,
        name: 'set-number',
        description: "[Manager] Set the question number (fixes today's if it already went out)",
        options: [{ type: INTEGER, name: 'number', description: 'Question number', required: true, min_value: 1 }],
      },
      {
        type: SUB_COMMAND,
        name: 'ping-now',
        description: "[Manager] Send today's ping now (or re-send it if it already went out)",
      },
    ],
  },
];
