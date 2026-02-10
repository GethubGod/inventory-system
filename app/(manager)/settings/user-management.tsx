import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { colors } from '@/constants';
import { useAuthStore } from '@/store';
import {
  ManagedUser,
  deleteManagedUserAccount,
  listManagedUsers,
  setManagedUserSuspended,
} from '@/services/userManagement';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';


type UserFilter = 'all' | 'employees' | 'managers' | 'active' | 'inactive' | 'suspended';

const FILTER_OPTIONS: { key: UserFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'employees', label: 'Employees' },
  { key: 'managers', label: 'Managers' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive (30d+)' },
  { key: 'suspended', label: 'Suspended' },
];

const INACTIVE_THRESHOLD_DAYS = 30;

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function getLastActivityDate(user: ManagedUser): Date | null {
  return toDate(user.last_order_at) ?? toDate(user.last_active_at);
}

function isInactive(user: ManagedUser): boolean {
  if (user.is_suspended) return false;
  const days = daysSince(getLastActivityDate(user));
  return days === null || days >= INACTIVE_THRESHOLD_DAYS;
}

function formatLastActivity(user: ManagedUser): string {
  const lastOrder = toDate(user.last_order_at);
  const lastActive = toDate(user.last_active_at);

  if (lastOrder) {
    const days = daysSince(lastOrder) ?? 0;
    if (days === 0) return 'Last order: today';
    if (days === 1) return 'Last order: 1 day ago';
    return `Last order: ${days} days ago`;
  }

  if (lastActive) {
    const days = daysSince(lastActive) ?? 0;
    if (days === 0) return 'Last active: today';
    if (days === 1) return 'Last active: 1 day ago';
    return `Last active: ${days} days ago`;
  }

  return 'No activity recorded';
}

export default function UserManagementScreen() {
  const { user: currentUser, profile } = useAuthStore();
  const isManager = (currentUser?.role ?? profile?.role) === 'manager';

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<UserFilter>('all');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    setErrorMessage(null);

    try {
      const data = await listManagedUsers();
      setUsers(data);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Unable to load users.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUsers();
    }, [loadUsers])
  );

  useEffect(() => {
    if (!flashMessage) return;
    const timer = setTimeout(() => setFlashMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [flashMessage]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return users.filter((candidate) => {
      const matchesSearch =
        query.length === 0 ||
        candidate.email.toLowerCase().includes(query) ||
        (candidate.full_name ?? '').toLowerCase().includes(query);

      if (!matchesSearch) return false;

      switch (selectedFilter) {
        case 'employees':
          return candidate.role === 'employee';
        case 'managers':
          return candidate.role === 'manager';
        case 'suspended':
          return candidate.is_suspended;
        case 'inactive':
          return isInactive(candidate);
        case 'active':
          return !candidate.is_suspended && !isInactive(candidate);
        case 'all':
        default:
          return true;
      }
    });
  }, [searchQuery, selectedFilter, users]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadUsers();
  }, [loadUsers]);

  const handleToggleSuspended = useCallback(
    async (targetUser: ManagedUser) => {
      if (targetUser.id === currentUser?.id) {
        Alert.alert('Action blocked', 'You cannot suspend your own account.');
        return;
      }

      const nextState = !targetUser.is_suspended;
      setUpdatingUserId(targetUser.id);

      try {
        await setManagedUserSuspended({
          userId: targetUser.id,
          isSuspended: nextState,
        });

        setUsers((prev) =>
          prev.map((entry) =>
            entry.id === targetUser.id ? { ...entry, is_suspended: nextState } : entry
          )
        );
        setFlashMessage(nextState ? 'User suspended.' : 'User unsuspended.');
      } catch (error: any) {
        Alert.alert('Update failed', error?.message || 'Unable to update suspension state.');
      } finally {
        setUpdatingUserId(null);
      }
    },
    [currentUser?.id]
  );

  const closeDeleteModal = useCallback(() => {
    if (isDeleting) return;
    setDeleteTarget(null);
    setConfirmText('');
    setManagerPassword('');
    setShowPassword(false);
  }, [isDeleting]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    if (confirmText.trim() !== 'DELETE') {
      Alert.alert('Confirmation required', 'Type DELETE to continue.');
      return;
    }
    if (!managerPassword) {
      Alert.alert('Password required', 'Enter your password to continue.');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteManagedUserAccount({
        userId: deleteTarget.id,
        managerPassword,
        confirmText: confirmText.trim(),
      });

      setUsers((prev) => prev.filter((candidate) => candidate.id !== deleteTarget.id));
      closeDeleteModal();
      setFlashMessage('Account deleted.');
    } catch (error: any) {
      Alert.alert('Delete failed', error?.message || 'Unable to delete account.');
    } finally {
      setIsDeleting(false);
    }
  }, [closeDeleteModal, confirmText, deleteTarget, managerPassword]);

  const renderUserRow = ({ item }: { item: ManagedUser }) => {
    const inactive = isInactive(item);
    const statusLabel = item.is_suspended ? 'Suspended' : inactive ? 'Inactive' : 'Active';
    const statusStyles = item.is_suspended
      ? { bg: 'bg-red-100', text: 'text-red-700' }
      : inactive
        ? { bg: 'bg-amber-100', text: 'text-amber-700' }
        : { bg: 'bg-green-100', text: 'text-green-700' };

    const roleStyles =
      item.role === 'manager'
        ? { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Manager' }
        : { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Employee' };

    const isSelf = item.id === currentUser?.id;
    const isUpdating = updatingUserId === item.id;

    return (
      <View className="bg-white rounded-2xl border border-gray-100 px-4 py-4 mb-3">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-gray-900">
              {item.full_name || 'Unnamed User'}
            </Text>
            <Text className="text-sm text-gray-500 mt-1">{item.email}</Text>
          </View>

          <View className="items-end">
            <View className={`px-2.5 py-1 rounded-full ${roleStyles.bg}`}>
              <Text className={`text-xs font-semibold ${roleStyles.text}`}>{roleStyles.label}</Text>
            </View>
            <View className={`px-2.5 py-1 rounded-full mt-1 ${statusStyles.bg}`}>
              <Text className={`text-xs font-semibold ${statusStyles.text}`}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        <Text className="text-xs text-gray-500 mt-2">{formatLastActivity(item)}</Text>

        {item.role === 'employee' && inactive && !item.is_suspended && (
          <View className="mt-2 self-start px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
            <Text className="text-xs text-amber-700 font-medium">Suggested: Suspend</Text>
          </View>
        )}

        <View className="flex-row mt-3">
          <TouchableOpacity
            className={`flex-1 rounded-xl py-2.5 items-center mr-2 border ${
              item.is_suspended
                ? 'bg-green-50 border-green-200'
                : 'bg-orange-50 border-orange-200'
            } ${isSelf ? 'opacity-50' : ''}`}
            disabled={isUpdating || isSelf}
            onPress={() => handleToggleSuspended(item)}
          >
            <Text
              className={`text-sm font-semibold ${
                item.is_suspended ? 'text-green-700' : 'text-orange-700'
              }`}
            >
              {isUpdating
                ? 'Saving...'
                : item.is_suspended
                  ? 'Unsuspend'
                  : 'Suspend'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className={`flex-1 rounded-xl py-2.5 items-center bg-red-50 border border-red-200 ${
              isSelf ? 'opacity-50' : ''
            }`}
            disabled={isSelf || isUpdating}
            onPress={() => {
              setDeleteTarget(item);
              setConfirmText('');
              setManagerPassword('');
              setShowPassword(false);
            }}
          >
            <Text className="text-sm font-semibold text-red-700">Delete</Text>
          </TouchableOpacity>
        </View>

        {isSelf && <Text className="text-xs text-gray-400 mt-2">Current account</Text>}
      </View>
    );
  };

  if (!isManager) {
    return <Redirect href="/(tabs)/settings" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 mr-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">User Management</Text>
      </View>

      <View className="px-4 pt-4">
        <View className="flex-row items-center bg-white rounded-xl border border-gray-200 px-3 py-2.5">
          <Ionicons name="search-outline" size={18} color={colors.gray[400]} />
          <TextInput
            className="flex-1 ml-2 text-gray-900"
            placeholder="Search by name or email"
            placeholderTextColor={colors.gray[400]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          horizontal
          data={FILTER_OPTIONS}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 2 }}
          renderItem={({ item }) => {
            const isSelected = item.key === selectedFilter;
            return (
              <TouchableOpacity
                className={`mr-2 px-3 py-1.5 rounded-full border ${
                  isSelected ? 'bg-primary-500 border-primary-500' : 'bg-white border-gray-200'
                }`}
                onPress={() => setSelectedFilter(item.key)}
              >
                <Text className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {flashMessage && (
        <View className="mx-4 mt-2 rounded-xl bg-green-100 px-3 py-2">
          <Text className="text-sm text-green-800 font-medium">{flashMessage}</Text>
        </View>
      )}

      {errorMessage && (
        <View className="mx-4 mt-3 rounded-xl bg-red-100 px-3 py-2">
          <Text className="text-sm text-red-700">{errorMessage}</Text>
        </View>
      )}

      <FlatList
        data={filteredUsers}
        renderItem={renderUserRow}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="people-outline" size={40} color={colors.gray[300]} />
            <Text className="text-gray-500 mt-3">
              {isLoading ? 'Loading users...' : 'No users found for this filter'}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#F97316" />
        }
      />

      <Modal
        visible={Boolean(deleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View className="flex-1 bg-black/40 justify-center px-5">
          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <Text className="text-lg font-bold text-gray-900">Delete Account</Text>
            <Text className="text-sm text-gray-600 mt-2">
              This action is irreversible. Type DELETE and enter your password to permanently
              remove this account.
            </Text>

            {deleteTarget && (
              <View className="mt-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <Text className="text-xs font-semibold text-red-700">
                  {deleteTarget.full_name || 'Unnamed User'} ({deleteTarget.email})
                </Text>
              </View>
            )}

            <View className="mt-3">
              <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Type DELETE
              </Text>
              <TextInput
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900"
                autoCapitalize="characters"
                autoCorrect={false}
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="DELETE"
                placeholderTextColor={colors.gray[400]}
              />
            </View>

            <View className="mt-3">
              <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Your Password
              </Text>
              <View className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 flex-row items-center">
                <TextInput
                  className="flex-1 text-gray-900"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={managerPassword}
                  onChangeText={setManagerPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.gray[400]}
                />
                <TouchableOpacity onPress={() => setShowPassword((prev) => !prev)} className="ml-2">
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.gray[500]}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View className="flex-row mt-4">
              <TouchableOpacity
                className="flex-1 rounded-xl py-3 items-center border border-gray-200 bg-white mr-2"
                onPress={closeDeleteModal}
                disabled={isDeleting}
              >
                <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 rounded-xl py-3 items-center ${
                  confirmText.trim() === 'DELETE' && managerPassword
                    ? 'bg-red-500'
                    : 'bg-red-300'
                }`}
                onPress={handleDelete}
                disabled={isDeleting || confirmText.trim() !== 'DELETE' || !managerPassword}
              >
                <Text className="text-sm font-semibold text-white">
                  {isDeleting ? 'Deleting...' : 'Delete account'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
