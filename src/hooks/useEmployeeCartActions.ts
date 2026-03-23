import { useOrderingCartActions } from './useOrderingCartActions';

export function useEmployeeCartActions() {
  return useOrderingCartActions('employee');
}
