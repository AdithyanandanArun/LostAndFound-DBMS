import { supabase } from "./supabase.js";
import { showToast, showSpinner, hideSpinner } from "./ui.js";

async function categoryId(slug) {
  const { data, error } = await supabase.from("categories").select("id").eq("slug", slug).single();
  if (error) throw error;
  return data.id;
}

function normalize(row) {
  return {
    id: row.id, title: row.title, description: row.description,
    category: row.categories?.slug || "other", location: row.locations?.name || "",
    date: row.occurred_on || "", contact: row.contact || "", status: row.status,
    createdAt: row.created_at, userId: row.app_users?.supabase_auth_user_id || "",
    imageUrl: row.item_images?.[0]?.public_url || "", imagePath: row.item_images?.[0]?.storage_path || "",
  };
}
const relationSelect = "*, categories(slug), locations(name), app_users!items_owner_id_fkey(supabase_auth_user_id), item_images(public_url,storage_path)";

export async function uploadImage(file, userId, onProgress) {
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "");
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("item-images").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  onProgress?.(100);
  const { data } = supabase.storage.from("item-images").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function createPost(type, data, imageFile, userId, onProgress) {
  showSpinner();
  let uploadedPath;
  try {
    const { data: profile, error: profileError } = await supabase.from("app_users").select("id").eq("supabase_auth_user_id", userId).single();
    if (profileError) throw profileError;
    const { data: location, error: locError } = data.location
      ? await supabase.from("locations").insert({ name: data.location }).select("id").single()
      : { data: null, error: null };
    if (locError) throw locError;
    const { data: item, error } = await supabase.from("items").insert({
      owner_id: profile.id, category_id: await categoryId(data.category), location_id: location?.id || null,
      kind: type, title: data.title, description: data.description, occurred_on: data.date || null,
      contact: data.contact || null,
    }).select("id").single();
    if (error) throw error;
    if (imageFile) {
      const image = await uploadImage(imageFile, userId, onProgress);
      uploadedPath = image.path;
      const { error: imageError } = await supabase.from("item_images").insert({
        item_id: item.id, storage_path: image.path, public_url: image.url, alt_text: data.title,
      });
      if (imageError) throw imageError;
    }
    showToast("Post created successfully! 🎉", "success");
    return item.id;
  } catch (err) {
    if (uploadedPath) await supabase.storage.from("item-images").remove([uploadedPath]);
    console.error(err); showToast("Failed to create post. Check Supabase setup and try again.", "error"); return null;
  } finally { hideSpinner(); }
}

export async function fetchPosts(type, filters = {}) {
  let query = supabase.from("items").select(relationSelect).eq("kind", type).order("created_at", { ascending: false });
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.userId) {
    const { data: profile } = await supabase.from("app_users").select("id").eq("supabase_auth_user_id", filters.userId).single();
    if (!profile) return [];
    query = query.eq("owner_id", profile.id);
  }
  if (filters.limit) query = query.limit(filters.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalize);
}

export async function fetchPost(type, id) {
  const { data, error } = await supabase.from("items").select(relationSelect).eq("kind", type).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalize(data) : null;
}

export async function updatePostStatus(type, id, status) {
  const { error } = await supabase.from("items").update({ status }).eq("id", id).eq("kind", type);
  if (error) { showToast("Could not update status.", "error"); throw error; }
  showToast(`Status updated to "${status}".`, "success");
}

export async function updatePost(type, id, data) {
  showSpinner();
  try {
    let locationId = null;
    if (data.location) {
      const { data: location, error } = await supabase.from("locations").insert({ name: data.location }).select("id").single();
      if (error) throw error;
      locationId = location.id;
    }
    const { error } = await supabase.from("items").update({
      title: data.title, category_id: await categoryId(data.category), description: data.description,
      location_id: locationId, occurred_on: data.date || null, contact: data.contact || null,
    }).eq("id", id).eq("kind", type);
    if (error) throw error;
    showToast("Post updated successfully.", "success"); return true;
  } catch (err) { console.error(err); showToast("Failed to update post.", "error"); return false; }
  finally { hideSpinner(); }
}

export async function deletePost(type, id, imagePath) {
  showSpinner();
  try {
    const { error } = await supabase.from("items").delete().eq("id", id).eq("kind", type);
    if (error) throw error;
    if (imagePath) await supabase.storage.from("item-images").remove([imagePath]);
    showToast("Post deleted.", "info"); return true;
  } catch (err) { console.error(err); showToast("Failed to delete post.", "error"); return false; }
  finally { hideSpinner(); }
}

export async function fetchRecentPosts(type, count = 6) { return fetchPosts(type, { limit: count }); }
