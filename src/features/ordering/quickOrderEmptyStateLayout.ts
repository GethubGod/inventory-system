export type QuickOrderEmptyStateLayout = {
  isEmpty: boolean;
  showConfirmHintOutsideOrderCard: boolean;
  showConfirmButtonInsideOrderCard: boolean;
};

export function getQuickOrderEmptyStateLayout(itemCount: number): QuickOrderEmptyStateLayout {
  const isEmpty = itemCount === 0;
  return {
    isEmpty,
    showConfirmHintOutsideOrderCard: false,
    showConfirmButtonInsideOrderCard: true,
  };
}
