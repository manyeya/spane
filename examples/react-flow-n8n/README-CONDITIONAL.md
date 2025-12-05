# Conditional Node Usage Guide

The conditional node allows you to branch your workflow based on a JavaScript expression.

## How It Works

1. **Add a Condition Node**: Drag a "Condition" node from the palette onto the canvas
2. **Configure the Condition**: Click on the node and enter a JavaScript expression in the config panel
3. **Connect Branches**: 
   - Connect the **green handle** (TRUE) to nodes that should run when the condition is true
   - Connect the **red handle** (FALSE) to nodes that should run when the condition is false

## Condition Expression

The condition expression is evaluated as JavaScript. You have access to:
- `input` - The data coming from the previous node
- `data` - Same as `input` (alias)

### Examples

```javascript
// Check if a value is greater than 100
input.value > 100

// Check HTTP response status
input.data?.ok === true

// Check if an array has items
input.items && input.items.length > 0

// Check string equality
input.status === "success"

// Complex condition
input.score >= 80 && input.verified === true
```

## Visual Feedback

During execution:
- The condition node shows which branch was taken (TRUE or FALSE)
- The active branch is highlighted in green/red
- The inactive branch is dimmed
- Nodes on the skipped branch show "skipped" status

## Example Workflow

```
[Trigger] → [HTTP Request] → [Condition: input.data?.ok] 
                                    ↓ TRUE → [Process Data] → [Send Email]
                                    ↓ FALSE → [Log Error] → [Alert Admin]
```

## Tips

1. Always test your condition expression with sample data
2. Use optional chaining (`?.`) to safely access nested properties
3. The condition must return a truthy/falsy value
4. Both branches can connect to the same downstream node (merge pattern)
