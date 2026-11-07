"use client";

import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createItemServerFn,
  deleteItemServerFn,
  updateItemServerFn,
  promoteItemsServerFn,
  duplicateItemsServerFn,
} from "@/lib/collections-helpers";
import { collectionPageQueryOptions, environmentsQueryOptions } from "@/lib/queries";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  ArrowLeft,
  Settings,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Code2,
  Calendar,
  Image as ImageIcon,
  Upload,
  Search,
  LoaderCircle,
  ChevronDown,
  Send,
  Copy,
} from "lucide-react";
import { Switch } from "@workspace/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { DataToolbar, type SortState } from "@workspace/ui/components/data-table";
import { SYSTEM_COLLECTION_FIELDS as SYSTEM_FIELDS } from "@/lib/collections-system-fields";
import {
  requestAssetUploadServerFn,
  confirmAssetUploadServerFn,
  listAssetsServerFn,
} from "@/lib/assets-helpers";
import { ALLOWED_ASSET_MIME_TYPES, MAX_ASSET_FILE_SIZE } from "@/lib/assets";

type CollectionField = {
  key: string;
  label: string;
  type: "text" | "url" | "number" | "boolean" | "date";
};

type ItemRecord = {
  id: string;
  data: Record<string, string | number | boolean | null>;
  environmentId?: string | null;
};

export const Route = createFileRoute("/dashboard/collections/$name/")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search.page ?? 1),
    projectId:
      typeof search.projectId === "string" && search.projectId.length > 0
        ? search.projectId
        : undefined,
    env:
      typeof search.env === "string" && search.env.length > 0
        ? search.env
        : undefined,
  }),
  component: CollectionPage,
});

function CollectionPage() {
  const { name } = Route.useParams();
  const search = Route.useSearch();
  const queryClient = useQueryClient();

  // Always fetch all items (no env filter) — we filter client-side for optimistic UX
  const pageQuery = useQuery(
    collectionPageQueryOptions(name, search.page, 100, search.projectId),
  );

  const [showModal, setShowModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ["collection-page", name],
    });
  }

  if (pageQuery.isLoading) {
    return <CollectionPageSkeleton />;
  }

  if (!pageQuery.data) {
    return (
      <section className="space-y-6">
        <div>
          <Link
            to="/dashboard"
            search={{ projectId: undefined }}
            className="inline-flex items-center gap-1.5 text-sm text-stone-500 transition hover:text-stone-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Collections
          </Link>
        </div>
        <p className="text-sm text-stone-500">Collection not found.</p>
      </section>
    );
  }

  const { collection, items } = pageQuery.data;

  const allSelected = items.items.length > 0 && selectedItems.size === items.items.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.items.map((item: ItemRecord) => item.id)));
    }
  }

  function toggleSelectItem(id: string) {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedItems.size} item(s)? This cannot be undone.`)) {
      return;
    }
    setBulkActionLoading(true);
    try {
      for (const id of selectedItems) {
        await deleteItemServerFn({ data: { id, slug: collection.slug } });
      }
      setSelectedItems(new Set());
      invalidate();
    } catch (error) {
      console.error("Failed to delete items:", error);
      alert("Failed to delete some items. Please try again.");
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkPublish(publish: boolean) {
    setBulkActionLoading(true);
    try {
      for (const id of selectedItems) {
        await updateItemServerFn({ data: { id, slug: collection.slug, values: { _published: publish } } });
      }
      setSelectedItems(new Set());
      invalidate();
    } catch (error) {
      console.error("Failed to update items:", error);
      alert("Failed to update some items. Please try again.");
    } finally {
      setBulkActionLoading(false);
    }
  }

  return (
    <CollectionPageContent
      collection={collection}
      items={items}
      search={search}
      editingItemId={editingItemId}
      setEditingItemId={setEditingItemId}
      showModal={showModal}
      setShowModal={setShowModal}
      message={message}
      setMessage={setMessage}
      previewImage={previewImage}
      setPreviewImage={setPreviewImage}
      confirmDeleteId={confirmDeleteId}
      setConfirmDeleteId={setConfirmDeleteId}
      onInvalidate={invalidate}
      selectedItems={selectedItems}
      setSelectedItems={setSelectedItems}
      toggleSelectAll={toggleSelectAll}
      toggleSelectItem={toggleSelectItem}
      handleBulkDelete={handleBulkDelete}
      handleBulkPublish={handleBulkPublish}
      bulkActionLoading={bulkActionLoading}
      allSelected={allSelected}
    />
  );
}

function CollectionPageContent(props: {
  collection: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    schema: CollectionField[];
  };
  items: {
    items: ItemRecord[];
    pagination: {
      page: number;
      totalPages: number;
      total: number;
      hasMore: boolean;
    };
  };
  search: { page: number; projectId?: string; env?: string };
  editingItemId: string | null;
  setEditingItemId: (id: string | null) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  message: { type: "success" | "error"; text: string } | null;
  setMessage: (
    msg: { type: "success" | "error"; text: string } | null,
  ) => void;
  previewImage: string | null;
  setPreviewImage: (url: string | null) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  onInvalidate: () => void;
  selectedItems: Set<string>;
  setSelectedItems: (items: Set<string>) => void;
  toggleSelectAll: () => void;
  toggleSelectItem: (id: string) => void;
  handleBulkDelete: () => Promise<void>;
  handleBulkPublish: (publish: boolean) => Promise<void>;
  bulkActionLoading: boolean;
  allSelected: boolean;
}) {
  const {
    collection,
    items,
    search,
    editingItemId,
    setEditingItemId,
    showModal,
    setShowModal,
    message,
    setMessage,
    previewImage,
    setPreviewImage,
    confirmDeleteId,
    setConfirmDeleteId,
    onInvalidate,
    selectedItems,
    setSelectedItems,
    toggleSelectAll,
    toggleSelectItem,
    handleBulkDelete,
    handleBulkPublish,
    bulkActionLoading,
    allSelected,
  } = props;

  // ── Environments ────────────────────────────────────────────
  const environmentsQuery = useQuery({
    ...environmentsQueryOptions(search.projectId ?? ""),
    enabled: !!search.projectId,
  });
  const allEnvironments = environmentsQuery.data ?? [];
  const productionEnv = allEnvironments.find((e) => e.isProduction) ?? allEnvironments[0] ?? null;
  const currentEnv = search.env
    ? allEnvironments.find((e) => e.slug === search.env) ?? productionEnv
    : productionEnv;

  // Client-side environment filtering (optimistic — instant switch)
  const filteredItems = useMemo(() => {
    if (!currentEnv) return items.items;
    if (currentEnv.isProduction) {
      return items.items.filter(
        (item: ItemRecord) => !item.environmentId || item.environmentId === currentEnv.id,
      );
    }
    return items.items.filter(
      (item: ItemRecord) => item.environmentId === currentEnv.id,
    );
  }, [items.items, currentEnv]);
  const tableFields: Array<
    | (typeof SYSTEM_FIELDS)[number]
    | CollectionField
  > = [...SYSTEM_FIELDS, ...collection.schema];

  const editingItem = useMemo(
    () =>
      items.items.find(
        (item: ItemRecord) => item.id === editingItemId,
      ) ?? null,
    [editingItemId, filteredItems],
  );

  async function handleDeleteItem(id: string) {
    const result = await deleteItemServerFn({
      data: {
        id,
        slug: collection.slug,
      },
    });

    setConfirmDeleteId(null);

    if (result?.success) {
      setMessage({ type: "success", text: "Item deleted." });
      onInvalidate();
    } else {
      setMessage({ type: "error", text: "Unable to delete item." });
    }
  }



  // ── Promote / Duplicate handlers ───────────────────────────
  const [duplicateTargetId, setDuplicateTargetId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function handlePromoteItems(itemIds: string[]) {
    if (!productionEnv || !currentEnv) return;
    if (currentEnv.id === productionEnv.id) {
      setMessage({ type: "error", text: "Items are already in the production environment." });
      return;
    }
    setActionLoading("promote");
    try {
      await promoteItemsServerFn({
        data: {
          itemIds,
          productionEnvironmentId: productionEnv.id,
          collectionSlug: collection.slug,
        },
      });
      setSelectedItems(new Set());
      setMessage({ type: "success", text: `${itemIds.length} item(s) promoted to ${productionEnv.name}.` });
      onInvalidate();
    } catch (error) {
      console.error("Promote failed:", error);
      setMessage({ type: "error", text: "Failed to promote items." });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDuplicateItems(itemIds: string[], targetEnvId: string) {
    if (!currentEnv) return;
    setActionLoading("duplicate");
    try {
      await duplicateItemsServerFn({
        data: {
          itemIds,
          sourceEnvironmentId: currentEnv.id,
          targetEnvironmentId: targetEnvId,
          collectionSlug: collection.slug,
        },
      });
      setSelectedItems(new Set());
      setDuplicateTargetId(null);
      const targetEnv = allEnvironments.find((e) => e.id === targetEnvId);
      setMessage({ type: "success", text: `${itemIds.length} item(s) duplicated to ${targetEnv?.name ?? "other"}.` });
      onInvalidate();
    } catch (error) {
      console.error("Duplicate failed:", error);
      setMessage({ type: "error", text: "Failed to duplicate items." });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <Link
          to="/dashboard"
          search={{ projectId: search.projectId }}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 transition hover:text-stone-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Collections
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {collection.name}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {collection.description ?? "Manage items for this collection."}
            {currentEnv ? (
              <>
                {" — "}
                <span className="font-medium text-stone-700">{filteredItems.length}</span>
                {" of "}
                {items.pagination.total}
                {" items in "}
                <span className="font-medium text-stone-700">{currentEnv.name}</span>
              </>
            ) : (
              <> -- {items.pagination.total} items</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard/collections/$name/schema"
            params={{ name: collection.slug }}
            search={{ projectId: search.projectId }}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-50"
          >
            <Settings className="h-4 w-4" />
            Edit schema
          </Link>
          <Link
            to="/dashboard/collections/$name/code"
            params={{ name: collection.slug }}
            search={{ projectId: search.projectId }}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-50"
          >
            <Code2 className="h-4 w-4" />
            Code
          </Link>
          <button
            type="button"
            onClick={() => {
              setEditingItemId(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <CollectionToolbar
        onRefresh={onInvalidate}
      />

      {message ? (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {message.text}
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {selectedItems.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-2.5 dark:border-stone-700 dark:bg-stone-900">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            {selectedItems.size} selected
          </span>
          <Separator orientation="vertical" className="h-5" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkPublish(true)}
            disabled={bulkActionLoading}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Publish
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkPublish(false)}
            disabled={bulkActionLoading}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Unpublish
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handlePromoteItems(Array.from(selectedItems))}
            disabled={actionLoading === "promote" || !currentEnv || currentEnv.id === productionEnv?.id || selectedItems.size === 0}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Promote {selectedItems.size > 1 ? `(${selectedItems.size})` : ""}
          </Button>
          {duplicateTargetId === "bulk" ? (
            <div className="flex items-center gap-1.5">
              <select
                className="rounded-md border border-stone-300 px-2 py-1.5 text-xs"
                onChange={(e) => {
                  if (e.target.value) {
                    void handleDuplicateItems(Array.from(selectedItems), e.target.value);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Target env…</option>
                {allEnvironments
                  .filter((e) => e.id !== currentEnv?.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => setDuplicateTargetId(null)}
                className="rounded-md px-2 py-1.5 text-xs text-stone-500 hover:text-stone-900"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDuplicateTargetId("bulk")}
              disabled={actionLoading === "duplicate" || selectedItems.size === 0}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Duplicate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkActionLoading}
            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedItems(new Set())}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="hidden max-h-[600px] overflow-auto rounded-lg border border-stone-200 md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                {tableFields.map((field) => (
                    <th
                      key={field.key}
                      className="px-4 py-3 text-left font-medium text-stone-600"
                    >
                      {field.label}
                    </th>
                  ))}
                <th className="px-4 py-3 text-right font-medium text-stone-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {filteredItems.map((item: ItemRecord) => (
                <tr key={item.id} className="hover:bg-stone-50">
                  <td className="px-3 py-3 align-top">
                    <Checkbox
                      checked={selectedItems.has(item.id)}
                      onCheckedChange={() => toggleSelectItem(item.id)}
                    />
                  </td>
                  {tableFields.map((field) => (
                      <td
                        key={field.key}
                        className="px-4 py-3 align-top text-stone-700"
                      >
                        <FieldValue
                          type={field.type}
                          value={item.data[field.key]}
                          onImagePreview={setPreviewImage}
                          truncate
                        />
                      </td>
                    ))}
                  <td className="px-4 py-3 text-right align-top">
                    <div className="flex justify-end gap-1.5">
                      {/* Promote button — only show if not already in production */}
                      {productionEnv && currentEnv && currentEnv.id !== productionEnv.id ? (
                        <button
                          type="button"
                          onClick={() => void handlePromoteItems([item.id])}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 hover:border-emerald-200"
                        >
                          <Send className="h-3 w-3" />
                          Promote
                        </button>
                      ) : null}
                      {/* Duplicate button */}
                      {allEnvironments.length > 1 ? (
                        duplicateTargetId === item.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              className="rounded-md border border-stone-300 px-2 py-1.5 text-xs"
                              onChange={(e) => {
                                if (e.target.value) {
                                  void handleDuplicateItems([item.id], e.target.value);
                                }
                              }}
                              defaultValue=""
                            >
                              <option value="" disabled>Target…</option>
                              {allEnvironments
                                .filter((e) => e.id !== currentEnv?.id)
                                .map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setDuplicateTargetId(null)}
                              className="rounded-md px-2 py-1.5 text-xs text-stone-500 hover:text-stone-900"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDuplicateTargetId(item.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-violet-600 transition hover:bg-violet-50 hover:border-violet-200"
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setShowModal(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-stone-50"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      {confirmDeleteId === item.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(item.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="inline-flex items-center rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-stone-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!items.items.length ? (
                <tr>
                  <td
                     colSpan={Math.max(2, tableFields.length + 1)}
                     className="px-4 py-10 text-center text-stone-500"
                   >
                    No items yet. Click{" "}
                    <span className="font-medium text-stone-700">Add item</span>{" "}
                    to create the first one.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>


      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {items.items.length ? (
          filteredItems.map((item: ItemRecord) => (
            <div
              key={item.id}
              className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedItems.has(item.id)}
                  onCheckedChange={() => toggleSelectItem(item.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {tableFields.map((field) => (
                    <div key={field.key}>
                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        {field.label}{" "}
                      </span>
                      <span className="text-sm text-stone-700 dark:text-stone-300">
                        <FieldValue
                          type={field.type}
                          value={item.data[field.key]}
                          onImagePreview={setPreviewImage}
                          truncate={false}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-stone-100 pt-3 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditingItemId(item.id);
                    setShowModal(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-stone-50"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
                {confirmDeleteId === item.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDeleteItem(item.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="inline-flex items-center rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-stone-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(item.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="py-10 text-center text-sm text-stone-500">
            No items yet. Click{" "}
            <span className="font-medium text-stone-700">Add item</span>{" "}
            to create the first one.
          </p>
        )}
      </div>      <div className="flex items-center justify-between text-sm">
        <span className="text-stone-500">
          Page {items.pagination.page} of {items.pagination.totalPages}
        </span>
        <div className="flex gap-2">
          <Link
            to="/dashboard/collections/$name"
            params={{ name: collection.slug }}
            search={{
              page: Math.max(1, search.page - 1),
              projectId: search.projectId,
              env: search.env,
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${search.page <= 1 ? "pointer-events-none border-stone-200 text-stone-300" : "border-stone-300 hover:bg-stone-50"}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Previous
          </Link>
          <Link
            to="/dashboard/collections/$name"
            params={{ name: collection.slug }}
            search={{
              page: Math.min(items.pagination.totalPages, search.page + 1),
              projectId: search.projectId,
              env: search.env,
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${!items.pagination.hasMore ? "pointer-events-none border-stone-200 text-stone-300" : "border-stone-300 hover:bg-stone-50"}`}
          >
            Next
            <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
          </Link>
        </div>
      </div>

      {showModal ? (
        <ItemEditorModal
          collection={collection}
          item={editingItem}
          projectId={search.projectId}
          environmentId={currentEnv?.id}
          onClose={() => setShowModal(false)}
          onSaved={(savedMessage) => {
            setMessage(savedMessage);
            setShowModal(false);
            onInvalidate();
          }}
        />
      ) : null}

      {previewImage ? (
        <button
          type="button"
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          aria-label="Close preview"
        >
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-full max-w-full rounded-lg bg-white object-contain"
          />
        </button>
      ) : null}
    </section>
  );
}

function CollectionPageSkeleton() {
  return (
    <section className="space-y-6">
      <div>
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      <div className="hidden max-h-[600px] overflow-auto rounded-lg border border-stone-200 md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                </th>
                <th className="px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-4 w-16" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-32" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Skeleton className="h-7 w-14 rounded-md" />
                      <Skeleton className="h-7 w-16 rounded-md" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {/* Mobile skeleton */}
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="mt-0.5 h-4 w-4 rounded" />
              <div className="min-w-0 flex-1 space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-stone-100 pt-3 dark:border-stone-800">
              <Skeleton className="h-7 w-14 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
          </div>
        ))}
      </div>      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
    </section>
  );
}

function FieldValue(props: {
  type: "text" | "url" | "number" | "boolean" | "date";
  value: unknown;
  onImagePreview?: (url: string) => void;
  truncate?: boolean;
}) {
  const content = (() => {
    if (props.type === "boolean") {
      return props.value ? (
        <span className="inline-flex items-center gap-1 text-green-600">
          <Check className="h-4 w-4" />
          Yes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-stone-400">
          <X className="h-4 w-4" />
          No
        </span>
      );
    }

    if (props.type === "url" && typeof props.value === "string") {
      const imageUrl = props.value;
      const looksLikeImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(imageUrl);

      if (looksLikeImage) {
        return (
          <button
            type="button"
            onClick={() => props.onImagePreview?.(imageUrl)}
            className="block"
          >
            <img
              src={imageUrl}
              alt="Preview"
              className="h-10 w-10 rounded-md object-cover"
            />
          </button>
        );
      }

      return (
        <a
          href={imageUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-stone-700 underline underline-offset-4 hover:text-stone-900"
        >
          <ExternalLink className="h-3 w-3" />
          {imageUrl}
        </a>
      );
    }

    if (props.type === "date" && typeof props.value === "string") {
      const date = new Date(props.value);

      if (Number.isNaN(date.getTime())) {
        return <span>{props.value}</span>;
      }

      return (
        <span className="inline-flex items-center gap-1.5 text-stone-700">
          <Calendar className="h-4 w-4 text-stone-400" />
          {new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }).format(date)}
        </span>
      );
    }

    return <span>{String(props.value ?? "-")}</span>;
  })();

  const stringValue = String(props.value ?? "");
  const needsTruncation = props.truncate && stringValue.length > 50;

  if (!needsTruncation) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help truncate block max-w-[200px]">
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-md break-all">
        {stringValue}
      </TooltipContent>
    </Tooltip>
  );
}

function ItemEditorModal(props: {
  collection: {
    id: string;
    slug: string;
    schema: CollectionField[];
  };
  item: ItemRecord | null;
  projectId?: string;
  environmentId?: string;
  onClose: () => void;
  onSaved: (message: { type: "success" | "error"; text: string }) => void;
}) {
  const [values, setValues] = useState<
    Record<string, string | number | boolean | null>
  >(() => {
    const initialValues: Record<string, string | number | boolean | null> = {};

    initialValues._published = props.item?.data._published ?? false;

    for (const field of props.collection.schema) {
      initialValues[field.key] =
        props.item?.data[field.key] ?? defaultValueForField(field.type);
    }

    return initialValues;
  });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    const result = props.item
      ? await updateItemServerFn({
          data: {
            id: props.item.id,
            slug: props.collection.slug,
            values,
            environmentId: props.item.environmentId ? undefined : props.environmentId,
          },
        })
      : await createItemServerFn({
          data: {
            collectionId: props.collection.id,
            slug: props.collection.slug,
            values,
            environmentId: props.environmentId,
          },
        });

    setPending(false);

    props.onSaved(
      result
        ? {
            type: "success",
            text: props.item ? "Item updated." : "Item created.",
          }
        : { type: "error", text: "Unable to save item." },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={props.item ? "Edit item" : "New item"}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold tracking-tight">
            {props.item ? "Edit item" : "New item"}
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-stone-700">Published</span>
            <FieldInput
              field={{ type: "boolean" }}
              value={values._published ?? false}
              onChange={(value) =>
                setValues((current) => ({ ...current, _published: value }))
              }
            />
            <span className="text-xs text-stone-400">
              Only published items are available on the public API.
            </span>
          </label>

          {props.collection.schema.map((field) => (
            <label key={field.key} className="grid gap-1.5">
              <span className="text-sm font-medium text-stone-700">
                {field.label}
              </span>
              <FieldInput
                field={field}
                value={values[field.key]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [field.key]: value }))
                }
                projectId={props.projectId}
              />
              <span className="text-xs text-stone-400">
                {field.type === "boolean"
                  ? "Toggle between true and false."
                  : field.type === "url"
                    ? "Enter a URL or select/upload an asset."
                    : field.type === "number"
                      ? "Enter a numeric value."
                      : field.type === "date"
                        ? "Pick a calendar date."
                      : "Enter text content."}
              </span>
            </label>
          ))}

          <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium transition hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? "Saving..."
                : props.item
                  ? "Save changes"
                  : "Create item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldInput(props: {
  field: { type: "text" | "url" | "number" | "boolean" | "date" };
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
  projectId?: string;
  onOpenAssetSelect?: (callback: (url: string) => void) => void;
  onOpenAssetUpload?: (callback: (url: string) => void) => void;
}) {
  if (props.field.type === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-stone-300 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-stone-700">
            {props.value === true ? "Enabled" : "Disabled"}
          </p>
          <p className="text-xs text-stone-400">Toggle this field on or off.</p>
        </div>
        <Switch
          checked={props.value === true}
          onCheckedChange={(checked) => props.onChange(checked)}
          aria-label="Toggle boolean field"
        />
      </div>
    );
  }

  if (props.field.type === "url") {
    return (
      <UrlFieldInput
        value={props.value as string | null}
        onChange={(value) => props.onChange(value)}
        projectId={props.projectId}
      />
    );
  }

  return (
    <input
      type={
        props.field.type === "number"
          ? "number"
          : props.field.type === "date"
            ? "date"
            : "text"
      }
      value={props.value === null ? "" : String(props.value)}
      onChange={(event) =>
        props.onChange(
          props.field.type === "number"
            ? event.target.value === ""
              ? null
              : Number(event.target.value)
            : event.target.value,
        )
      }
      placeholder={
        props.field.type === "number"
          ? "0"
          : props.field.type === "date"
            ? "YYYY-MM-DD"
          : "Enter value..."
      }
      className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
    />
  );
}

function UrlFieldInput(props: {
  value: string | null;
  onChange: (value: string | null) => void;
  projectId?: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAssetSelect, setShowAssetSelect] = useState(false);
  const [showAssetUpload, setShowAssetUpload] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelectAsset(url: string) {
    props.onChange(url);
    setShowDropdown(false);
  }

  function handleUploadAsset(url: string) {
    props.onChange(url);
    setShowDropdown(false);
  }

  return (
    <>
      <div className="relative flex">
        <input
          type="text"
          value={props.value ?? ""}
          onChange={(event) => props.onChange(event.target.value || null)}
          placeholder="https://example.com"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 pr-10 text-sm outline-none transition focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
        />
        <div ref={dropdownRef} className="absolute right-1 top-1/2 -translate-y-1/2">
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            aria-label="Asset options"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          {showDropdown && (
            <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
              <button
                type="button"
                onClick={() => {
                  setShowDropdown(false);
                  setShowAssetSelect(true);
                }}
                disabled={!props.projectId}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <ImageIcon className="h-4 w-4" />
                Select Existing Asset
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDropdown(false);
                  setShowAssetUpload(true);
                }}
                disabled={!props.projectId}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <Upload className="h-4 w-4" />
                Upload Asset
              </button>
            </div>
          )}
        </div>
      </div>
      {showAssetSelect && props.projectId ? (
        <AssetSelectDialog
          projectId={props.projectId}
          onSelect={handleSelectAsset}
          onClose={() => setShowAssetSelect(false)}
        />
      ) : null}
      {showAssetUpload && props.projectId ? (
        <AssetUploadInlineDialog
          projectId={props.projectId}
          onUpload={handleUploadAsset}
          onClose={() => setShowAssetUpload(false)}
        />
      ) : null}
    </>
  );
}

function defaultValueForField(
  type: "text" | "url" | "number" | "boolean" | "date",
) {
  if (type === "boolean") {
    return false;
  }

  if (type === "number") {
    return null;
  }

  return "";
}

// Asset Select Dialog
function AssetSelectDialog(props: {
  projectId: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<"all" | "images" | "documents">("all");

  const assetsQuery = useQuery({
    queryKey: ["asset-select", props.projectId],
    queryFn: () => listAssetsServerFn({ data: { page: 1, limit: 100, projectId: props.projectId } }),
    enabled: !!props.projectId,
    staleTime: 30_000,
  });

  const filteredAssets = useMemo(() => {
    const assets = assetsQuery.data?.items ?? [];
    let filtered = assets;

    if (selectedType === "images") {
      filtered = filtered.filter((a) => a.contentType.startsWith("image/"));
    } else if (selectedType === "documents") {
      filtered = filtered.filter((a) => a.contentType === "application/pdf");
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((a) => a.filename.toLowerCase().includes(searchLower));
    }

    return filtered;
  }, [assetsQuery.data?.items, selectedType, search]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Select asset"
    >
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 dark:border-stone-700">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Select Asset</h3>
            <p className="mt-1 text-sm text-stone-500">Choose from your existing assets</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-6 py-3 dark:border-stone-700">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "images", "documents"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  selectedType === type
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                }`}
              >
                {type === "all" ? "All" : type === "images" ? "Images" : "Documents"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {assetsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                  <Skeleton className="aspect-square w-full" />
                  <div className="p-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-1 h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                <ImageIcon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-medium text-stone-900 dark:text-stone-100">
                {search ? "No assets match your search" : "No assets yet"}
              </h3>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                {search ? "Try a different search term" : "Upload an asset to get started"}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    props.onSelect(asset.publicUrl);
                    props.onClose();
                  }}
                  className="group overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-stone-100 via-stone-50 to-stone-200 dark:from-stone-900 dark:via-stone-800 dark:to-stone-900">
                    {asset.contentType.startsWith("image/") ? (
                      <img
                        src={asset.publicUrl}
                        alt={asset.filename}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-stone-400 dark:text-stone-500" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-1 text-sm font-medium text-stone-900 dark:text-stone-100">
                      {asset.filename}
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {formatAssetSize(asset.size)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline Asset Upload Dialog for URL fields
function AssetUploadInlineDialog(props: {
  projectId: string;
  onUpload: (url: string) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = useMemo(() => ALLOWED_ASSET_MIME_TYPES.join(","), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) props.onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pending, props.onClose]);

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    if (!selectedFile) return;
    setError(null);

    if (!ALLOWED_ASSET_MIME_TYPES.includes(selectedFile.type as (typeof ALLOWED_ASSET_MIME_TYPES)[number])) {
      setError(`Unsupported file type: ${selectedFile.type || "unknown"}`);
      return;
    }

    if (selectedFile.size > MAX_ASSET_FILE_SIZE) {
      setError(`File is too large (${formatAssetSize(selectedFile.size)}). Max 10MB.`);
      return;
    }

    setFile(selectedFile);
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current++;
    if (event.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      const droppedFile = event.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!props.projectId) {
      setError("Select a project before uploading assets.");
      return;
    }

    if (!file) {
      setError("Choose a file to upload.");
      return;
    }

    setPending(true);
    setError(null);
    setUploadProgress(0);

    try {
      const request = await requestAssetUploadServerFn({
        data: {
          projectId: props.projectId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        },
      });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", request.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (${xhr.status}).`));
          }
        });

        xhr.addEventListener("error", () =>
          reject(new Error("Upload failed. Check your network connection.")),
        );

        xhr.send(file);
      });

      await confirmAssetUploadServerFn({ data: { id: request.assetId } });
      props.onUpload(request.publicUrl);
      props.onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload asset.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) props.onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload asset"
    >
      <div className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Upload Asset</h3>
            <p className="mt-1 text-sm text-stone-500">Upload a file to use as URL value</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={pending}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <label
            className={`grid cursor-pointer gap-3 rounded-xl border-2 border-dashed p-6 text-center transition ${
              isDragging
                ? "border-stone-900 bg-stone-100 dark:border-stone-400 dark:bg-stone-800"
                : file
                  ? "border-stone-400 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/40"
                  : "border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800/40 dark:hover:border-stone-600 dark:hover:bg-stone-800"
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {formatAssetSize(file.size)} · {file.type}
                  </p>
                </div>
                {!pending && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setFile(null);
                    }}
                    className="mt-2 text-xs text-stone-500 underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-300"
                  >
                    Remove file
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
                    {isDragging ? "Drop your file here" : "Drag & drop or click to browse"}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    Images, PDFs, and videos up to 10MB
                  </p>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedTypes}
              onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>

          {pending && uploadProgress > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>Uploading...</span>
                <span className="tabular-nums">{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <div
                  className="h-full rounded-full bg-stone-900 transition-all duration-300 ease-out dark:bg-stone-100"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {error ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <button
              type="button"
              onClick={props.onClose}
              disabled={pending}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !file}
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {pending ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collection toolbar (filter + sort + refresh)
// ---------------------------------------------------------------------------

function CollectionToolbar({ onRefresh }: {
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);

  return (
    <DataToolbar
      query={query}
      onQueryChange={setQuery}
      refresh={{
        onRefresh,
        isRefreshing: false,
      }}
      sortColumns={[
        { id: "name", label: "Name" },
        { id: "createdAt", label: "Created" },
      ]}
      sort={sort}
      onSortChange={setSort}
      filterPlaceholder="Filter items…"
    />
  );
}

function formatAssetSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
