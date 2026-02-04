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

  useEffect(() => {
    if (!user?.id) return;

    // Subscribe to order changes
    const channel = supabase
      .channel('order-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        async (payload) => {
          const newOrder = payload.new as OrderChange;
          const oldOrder = payload.old as OrderChange | undefined;

          // Check if this order belongs to the current user or if they're a manager
          const isMyOrder = newOrder.user_id === user.id;
          const isManager = user.role === 'manager';

          if (!isMyOrder && !isManager) return;

          // Get the previous status we knew about
          const previousStatus = oldOrder?.status || previousStatusRef.current[newOrder.id];

          // Check if status actually changed
          if (previousStatus && previousStatus !== newOrder.status) {
            // Update our tracking of the status
            previousStatusRef.current[newOrder.id] = newOrder.status;

            // Refresh orders in the store
            if (isManager) {
              // Managers see all orders - let fulfillment screen refresh
              // The specific screens will call their own fetch functions
            } else {
              // Employees see their own orders
              useOrderStore.getState().fetchUserOrders(user.id);
            }

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
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
        },
        async (payload) => {
          const newOrder = payload.new as OrderChange;

          // Only managers care about new orders from others
          const isManager = user.role === 'manager';
          const isMyOrder = newOrder.user_id === user.id;

          if (isManager && !isMyOrder && newOrder.status === 'submitted') {
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
      .subscribe();

    channelRef.current = channel;

    return () => {
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
