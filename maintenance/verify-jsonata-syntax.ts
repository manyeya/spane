import jsonata from 'jsonata';

// Mock context matching the backend implementation
const context = {
    inputData: {
        currentStatus: 'active',
        localValue: 999
    },
    allNodeResults: {
        'trigger': {
            success: true,
            data: { timestamp: 1234567890 }
        },
        'step-1': {
            success: true,
            data: {
                price: 50,
                user: { name: 'Alice', role: 'admin' }
            }
        },
        'http-request': {
            success: true,
            data: { status: 200, body: { id: 1 } }
        }
    }
};

async function testExpression(expr: string) {
    try {
        const expression = jsonata(expr);

        // Exact implementation from react-flow-backend.ts
        expression.registerFunction('node', (nodeId: string) => {
            // @ts-ignore
            if (!context.allNodeResults) return undefined;
            // @ts-ignore
            return context.allNodeResults[nodeId]?.data;
        });

        const bindings = {
            input: context.inputData
        };

        const result = await expression.evaluate(context.inputData, bindings);
        console.log(`✅ "${expr}"  ::  ${JSON.stringify(result)}`);
    } catch (error: any) {
        console.error(`❌ "${expr}"  ::  Error: ${error.message}`);
    }
}

console.log('--- Testing JSONata Syntax ---');

// 1. Basic Field Access
await testExpression('currentStatus');
await testExpression('localValue > 500');

// 2. $input Helper
await testExpression('$input.localValue');

// 3. $node Helper
await testExpression('$node("step-1").price');
await testExpression('$node("step-1").user.name');
await testExpression('$node("http-request").status = 200');

// 4. Complex Logic
await testExpression('$node("step-1").price = 50 and localValue > 100');
await testExpression('$node("trigger").timestamp');

console.log('--- End Test ---');
