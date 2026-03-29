/**
 * Test script for better-logger v5 CLI primitives
 * Verifying the linked package works correctly
 */

import logger, {
    step,
    spinner,
    box,
    cliTable,
    header,
    divider,
    blank,
    setCLILevel,
    type CLILogLevel,
    type ISpinnerHandle,
    type IBoxOptions,
    type ITableOptions,
} from '@mks2508/better-logger';

// Test 1: Header
header('Commit Wizard', 'v2.0.0 - Logger Test');
blank();

// Test 2: Step progress
step(1, 4, 'Testing step progress...');
step(2, 4, 'Testing spinner...');
blank();

// Test 3: Spinner
const spin = spinner('Loading with spinner...');
spin.start();

// Simulate async work
await new Promise(resolve => setTimeout(resolve, 1500));

spin.succeed('Spinner test complete!');
blank();

// Test 4: Table
const providers = [
    { name: 'Gemini SDK', status: 'Available', model: 'gemini-2.5-flash' },
    { name: 'Groq', status: 'Available', model: 'llama-3.3-70b-versatile' },
    { name: 'OpenRouter', status: 'Missing', model: 'anthropic/claude-sonnet-4' },
];
cliTable(providers);
blank();

// Test 5: Box
box('This is a test box\nwith multiple lines\nand custom styling', {
    title: 'Box Test',
    borderColor: 'cyan',
    borderStyle: 'rounded',
    padding: 1,
});
blank();

// Test 6: Divider
divider();
blank();

// Test 7: Level testing
step(3, 4, 'Testing CLI levels...');

// Test different levels
setCLILevel('normal');
logger.info('This is an info message (normal level shows this)');
logger.success('This is a success message');
logger.warn('This is a warning');
logger.error('This is an error');
logger.debug('This debug message should NOT show in normal level');

blank();
step(4, 4, 'All tests complete!');
blank();

box('✅ Better Logger v5 CLI primitives working correctly!', {
    title: 'Success',
    borderColor: 'green',
    borderStyle: 'rounded',
    padding: 1,
});
