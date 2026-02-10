import { useEffect, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useOrderStore, useAuthStore, useSettingsStore } from '@/store';
import { sendOrderStatusNotification } from '@/services/notificationService';
import { OrderStatus } from '@/types';

interface OrderChange {
  id: string;
  order_number: number;
  user_id: string;
  location_id: string;
  status: OrderStatus;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
}

export function useOrderSubscription() {
  const { user } = useAuthStore();
  const { notifications } = useSettingsStore();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const previousStatusRef = useRef<Record<string, OrderStatus>>({});
  const managerRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const employeeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const isManager = user.role === 'manager';

    const scheduleOrdersRefresh = (target: 'manager' | 'employee') => {
      const timeoutRef =
        target === 'manager' ? managerRefreshTimeoutRef : employeeRefreshTimeoutRef;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        if (target === 'manager') {
          useOrderStore
            .getState()
            .fetchManagerOrders()
            .catch(() => {
              // Keep subscription alive even if one refresh fails.
            });
        } else {
          useOrderStore
            .getState()
            .fetchUserOrders(user.id)
            .catch(() => {
              // Keep subscription alive even if one refresh fails.
            });
        }
      }, 250);
    };

    // Subscribe to order changes
    const channel = supabase
      .channel(`order-changes-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        async (payload) => {
          const eventType = (payload as any).eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const newOrder =
            payload.new && Object.keys(payload.new as Record<string, unknown>).length > 0
              ? (payload.new as OrderChange)
              : null;
          const oldOrder =
            payload.old && Object.keys(payload.old as Record<string, unknown>).length > 0
              ? (payload.old as OrderChange)
              : null;
          const orderForScope = newOrder ?? oldOrder;

          if (!orderForScope) return;

          // Check if this order belongs to the current user or if they're a manager
          const isMyOrder = orderForScope.user_id === user.id;

          if (!isMyOrder && !isManager) return;

          scheduleOrdersRefresh(isManager ? 'manager' : 'employee');

          if (eventType === 'UPDATE' && newOrder) {
            // Get the previous status we knew about
            const previousStatus = oldOrder?.status || previousStatusRef.current[newOrder.id];

            // Check if status actually changed
            if (previousStatus && previousStatus !== newOrder.status) {
              // Update our tracking of the status
              previousStatusRef.current[newOrder.id] = newOrder.status;

              // Send notification if enabled
              if (notifications.pushEnabled && notifications.orderStatus) {
                // Only notify the order owner about status changes
                if (isMyOrder && newOrder.status !== 'draft') {
                  await sendOrderStatusNotification(
                    newOrder.status,
                    newOrder.order_number
                  );
                }
              }
            }

            return;
          }

          if (newOrder) {
            previousStatusRef.current[newOrder.id] = newOrder.status;
          }

          if (eventType === 'INSERT' && newOrder && isManager && !isMyOrder && newOrder.status === 'submitted') {
            // Notify manager about new submitted order
            if (notifications.pushEnabled && notifications.newOrders) {
              await sendOrderStatusNotification(
                'submitted',
                newOrder.order_number
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
        },
        () => {
          // Managers need current line-item details while keeping screens open.
          if (isManager) {
            scheduleOrdersRefresh('manager');
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (managerRefreshTimeoutRef.current) {
        clearTimeout(managerRefreshTimeoutRef.current);
        managerRefreshTimeoutRef.current = null;
      }

      if (employeeRefreshTimeoutRef.current) {
        clearTimeout(employeeRefreshTimeoutRef.current);
        employeeRefreshTimeoutRef.current = null;
      }

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, user?.role, notifications.pushEnabled, notifications.orderStatus, notifications.newOrders]);

  // Return a function to manually trigger a refresh
  const refreshOrders = async () => {
    if (!user?.id) return;

    if (user.role === 'manager') {
      await useOrderStore.getState().fetchManagerOrders();
    } else {
      await useOrderStore.getState().fetchUserOrders(user.id);
    }
  };

  return { refreshOrders };
}
