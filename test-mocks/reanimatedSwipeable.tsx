import React from 'react';

/**
 * Jest stub for `react-native-gesture-handler/ReanimatedSwipeable`.
 *
 * The real module ships as untransformed ESM, which the ts-jest config (no
 * node_modules transform) cannot load. Tests only care that the row renders, so
 * this passthrough renders the children and ignores the swipe affordances.
 */
const ReanimatedSwipeable = React.forwardRef<unknown, { children?: React.ReactNode }>(
  ({ children }, _ref) => <>{children}</>,
);
ReanimatedSwipeable.displayName = 'ReanimatedSwipeable';

export default ReanimatedSwipeable;
export const SwipeDirection = { LEFT: 'left', RIGHT: 'right' } as const;
