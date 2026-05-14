export type QuickOrderEmptyStateLayout = {
  isEmpty: boolean;
  showShortcutChipsOutsideOrderCard: boolean;
  showConfirmHintOutsideOrderCard: boolean;
  showConfirmButtonInsideOrderCard: boolean;
};

export function getQuickOrderEmptyStateLayout(itemCount: number): QuickOrderEmptyStateLayout {
  const isEmpty = itemCount === 0;
  return {
    isEmpty,
    showShortcutChipsOutsideOrderCard: isEmpty,
    showConfirmHintOutsideOrderCard: false,
    showConfirmButtonInsideOrderCard: true,
  };
}
