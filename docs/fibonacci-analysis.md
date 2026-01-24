# Fibonacci Sequence: A Comprehensive Analysis

## What is the Fibonacci Sequence?

The Fibonacci sequence is one of the most famous number sequences in mathematics. It begins with 0 and 1, and each subsequent number is the sum of the two preceding numbers:

```
0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, ...
```

**Mathematical Definition:**
- F(0) = 0
- F(1) = 1
- F(n) = F(n-1) + F(n-2) for n > 1

The sequence appears throughout nature (spiral patterns in shells, flower petals, pine cones), computer science (data structures, algorithms), finance (technical analysis), and art (the golden ratio).

---

## Implementation Approaches

### 1. Recursive Implementation

The recursive approach directly mirrors the mathematical definition:

```typescript
/**
 * Recursive Fibonacci implementation
 * Directly follows the mathematical definition: F(n) = F(n-1) + F(n-2)
 */
function fibonacciRecursive(n: number): number {
  // Base cases
  if (n <= 0) return 0;
  if (n === 1) return 1;

  // Recursive case: sum of two preceding numbers
  return fibonacciRecursive(n - 1) + fibonacciRecursive(n - 2);
}

// Example usage:
// fibonacciRecursive(10) returns 55
// fibonacciRecursive(20) returns 6765
```

**How it works:**
1. For n=0, return 0 (base case)
2. For n=1, return 1 (base case)
3. For n>1, recursively compute F(n-1) and F(n-2), then sum them

**Call tree for fibonacciRecursive(5):**
```
                    fib(5)
                   /      \
              fib(4)       fib(3)
             /     \       /     \
         fib(3)   fib(2) fib(2)  fib(1)
         /    \   /    \  /    \
     fib(2) fib(1) fib(1) fib(0) fib(1) fib(0)
     /    \
 fib(1)  fib(0)
```

### 2. Iterative Implementation

The iterative approach builds the sequence from the bottom up:

```typescript
/**
 * Iterative Fibonacci implementation
 * Builds sequence from bottom-up, storing only the last two values
 */
function fibonacciIterative(n: number): number {
  // Handle base cases
  if (n <= 0) return 0;
  if (n === 1) return 1;

  // Start with first two Fibonacci numbers
  let prev2 = 0;  // F(0)
  let prev1 = 1;  // F(1)
  let current = 0;

  // Build up to F(n)
  for (let i = 2; i <= n; i++) {
    current = prev1 + prev2;
    prev2 = prev1;
    prev1 = current;
  }

  return current;
}

// Example usage:
// fibonacciIterative(10) returns 55
// fibonacciIterative(50) returns 12586269025
```

**How it works:**
1. Start with F(0)=0 and F(1)=1
2. In each iteration, compute the next number as sum of previous two
3. Slide the "window" forward by updating prev2 and prev1
4. Continue until reaching F(n)

---

## Time Complexity Analysis

### Recursive: O(2^n) - Exponential

The naive recursive implementation has **exponential time complexity**.

**Why?**
- Each call to `fib(n)` spawns two more calls: `fib(n-1)` and `fib(n-2)`
- This creates a binary tree of calls
- The tree has approximately 2^n nodes

**Proof by recurrence:**
```
T(n) = T(n-1) + T(n-2) + O(1)

The recurrence relation mirrors the Fibonacci sequence itself!
T(n) ≈ φ^n where φ (phi) ≈ 1.618 (golden ratio)

Since φ^n = O(2^n), the time complexity is exponential.
```

**Practical impact:**
| n   | Approximate calls | Time (rough estimate) |
|-----|-------------------|----------------------|
| 10  | ~177              | <1 ms               |
| 20  | ~21,891           | ~1 ms               |
| 30  | ~2.7 million      | ~100 ms             |
| 40  | ~331 million      | ~10 seconds         |
| 50  | ~40 billion       | ~20 minutes         |

### Iterative: O(n) - Linear

The iterative implementation has **linear time complexity**.

**Why?**
- Single loop from 2 to n
- Each iteration does constant work (one addition, two assignments)
- Total: n-1 iterations = O(n)

**Practical impact:**
| n      | Iterations | Time (rough estimate) |
|--------|-----------|----------------------|
| 10     | 9         | <1 ms               |
| 100    | 99        | <1 ms               |
| 1000   | 999       | <1 ms               |
| 10000  | 9999      | <1 ms               |
| 100000 | 99999     | ~1 ms               |

---

## Space Complexity Analysis

### Recursive: O(n) - Linear Stack Space

Although the recursive solution doesn't explicitly allocate memory, it uses the **call stack**.

**Stack depth analysis:**
- Each recursive call adds a frame to the call stack
- Maximum depth = n (the deepest path in the call tree)
- Each frame stores: return address, local variables, parameters

```
For fib(5), max stack depth:
fib(5) → fib(4) → fib(3) → fib(2) → fib(1)
       [5 stack frames at maximum depth]
```

**Risks:**
- Large n values can cause **stack overflow**
- Default stack sizes: ~1MB (typical), allowing ~10,000-50,000 frames
- `fib(100000)` would likely crash before completing

### Iterative: O(1) - Constant Space

The iterative solution uses only a **fixed number of variables**.

**Memory usage:**
- `prev2`: stores F(i-2)
- `prev1`: stores F(i-1)
- `current`: stores F(i)
- `i`: loop counter
- `n`: input parameter

Total: 5 variables regardless of input size = **O(1)**

**Advantage:**
- No stack overflow risk
- Memory usage independent of n
- Can compute arbitrarily large Fibonacci numbers (limited only by integer overflow)

---

## Comparison Summary

| Aspect | Recursive | Iterative |
|--------|-----------|-----------|
| **Time Complexity** | O(2^n) exponential | O(n) linear |
| **Space Complexity** | O(n) stack frames | O(1) constant |
| **Code Clarity** | Mirrors math definition | Requires understanding of state |
| **Performance** | Slow for n > 30 | Fast for any practical n |
| **Stack Overflow Risk** | High for large n | None |
| **Redundant Work** | Massive (fib(2) computed ~fib(n) times) | None |

---

## Optimization: Memoization

We can improve the recursive version using **memoization** - caching previously computed results:

```typescript
/**
 * Memoized Fibonacci - combines recursive elegance with efficiency
 * Time: O(n), Space: O(n)
 */
function fibonacciMemoized(n: number, memo: Map<number, number> = new Map()): number {
  // Check cache first
  if (memo.has(n)) {
    return memo.get(n)!;
  }

  // Base cases
  if (n <= 0) return 0;
  if (n === 1) return 1;

  // Compute and cache
  const result = fibonacciMemoized(n - 1, memo) + fibonacciMemoized(n - 2, memo);
  memo.set(n, result);

  return result;
}
```

This achieves O(n) time complexity while maintaining the recursive structure, at the cost of O(n) space for the cache.

---

## When to Use Each Approach

**Use Recursive when:**
- Teaching or demonstrating the concept
- n is very small (< 20)
- Code readability is paramount and performance isn't critical

**Use Iterative when:**
- Performance matters
- n could be large
- Memory/stack is constrained
- Production code

**Use Memoized when:**
- You want recursive clarity with better performance
- Multiple Fibonacci lookups in the same context
- You're already working with dynamic programming patterns

---

## Conclusion

The Fibonacci sequence provides an excellent case study in algorithm design:

1. **The naive recursive solution** is elegant and mirrors the mathematical definition, but its exponential time complexity makes it impractical for anything beyond small inputs.

2. **The iterative solution** trades some code elegance for dramatic performance improvements - from O(2^n) to O(n) time and from O(n) to O(1) space.

3. **Understanding these trade-offs** is fundamental to computer science and helps developers make informed decisions about algorithm selection in real-world applications.

The 2^n vs n difference isn't just academic - it's the difference between a program that computes fib(50) in microseconds versus one that would take years.
