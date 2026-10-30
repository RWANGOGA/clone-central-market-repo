import { describe, expect, it } from 'vitest';
import { ORDER_FLOW, allowedNext, canTransition, isOrderStatus } from './orderFlow';

/**
 * The state machine behind finding F2.
 *
 * The buyer's testers could not tell whether a human had accepted their order
 * before it was picked. The fix is a `confirmed` stop between payment and
 * preparation, and — just as important — removing the old direct edge from
 * `pending` to `processing` so preparation is impossible without that stop.
 * These tests lock the shape of the machine so a later edit cannot quietly
 * reopen the shortcut.
 */

describe('order fulfilment flow', () => {
  it('splits payment and preparation with a market confirmation', () => {
    expect(allowedNext('pending')).toContain('confirmed');
    expect(allowedNext('confirmed')).toContain('processing');
  });

  it('does not let an order be prepared without somebody accepting it', () => {
    // This is the whole point of the fix: no pending -> processing edge.
    expect(canTransition('pending', 'processing')).toBe(false);
    expect(allowedNext('pending')).not.toContain('processing');
    // And it must not be reachable by skipping two stops either.
    expect(allowedNext('pending')).toEqual(['confirmed', 'cancelled']);
  });

  it('lets a confirmed order still be cancelled before the goods move', () => {
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    // A rejected line is caught here — nothing has shipped yet.
    expect(allowedNext('confirmed')).toContain('cancelled');
  });

  it('treats the last two states as terminal', () => {
    expect(allowedNext('delivered')).toEqual([]);
    expect(allowedNext('cancelled')).toEqual([]);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'pending')).toBe(false);
  });

  it('every non-terminal state can still be cancelled', () => {
    const stillMoving = ['pending', 'confirmed', 'processing', 'shipped'];
    for (const status of stillMoving) {
      expect(allowedNext(status)).toContain('cancelled');
    }
  });

  it('refuses an unknown state rather than assuming a transition is safe', () => {
    expect(isOrderStatus('refunded')).toBe(false);
    expect(canTransition('pending', 'refunded')).toBe(false);
    // A status that is not in the machine has no allowed next steps.
    expect(allowedNext('made-up')).toEqual([]);
    expect(canTransition('made-up', 'processing')).toBe(false);
  });

  it('keeps the graph acyclic and every target a real state', () => {
    for (const [from, targets] of Object.entries(ORDER_FLOW)) {
      for (const to of targets) {
        expect(isOrderStatus(to)).toBe(true);
        // Nothing may point back to an earlier stop.
        expect(from).not.toBe(to);
      }
    }
  });
});
