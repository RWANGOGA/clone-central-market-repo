/**
 * Who may end an order, and why not.
 *
 * Kept apart from `orderCancellation` on purpose: the transactional half needs
 * a database, while this decision is pure. The customer-facing order view needs
 * the rule, and being able to ask it without opening a connection keeps the
 * projection testable.
 */

/**
 * Which statuses a customer may end themselves.
 *
 * Deliberately narrower than the staff machine. Once picking starts the goods
 * may already be packed and a rider assigned, so the customer has to ask rather
 * than cancel.
 */
export const CUSTOMER_CANCELLABLE: readonly string[] = ['pending'];

export function customerCancelBlocker(status: string): string | null {
  if (CUSTOMER_CANCELLABLE.includes(status)) return null;
  switch (status) {
    case 'processing':
      return 'Picking has already started, so this order needs staff to cancel it. Send a note to the market team.';
    case 'confirmed':
      // The market has said it will fill the order and the goods are being held
      // for them. Cancelling after that is a decision about somebody else's work,
      // not a button press, so it goes through staff.
      return 'The market has confirmed this order and is preparing it, so please contact the team to cancel.';
    case 'shipped':
      return 'A rider is already carrying this order, so it cannot be cancelled here. Refuse the delivery, or contact us once it arrives.';
    case 'delivered':
      return 'This order was delivered. Anything wrong with it is a return or a refund, which staff handle.';
    case 'cancelled':
      return 'This order is already cancelled.';
    default:
      return 'This order cannot be cancelled right now.';
  }
}
