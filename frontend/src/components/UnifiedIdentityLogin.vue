<script setup>
defineProps({
  loginUrl: { type: String, required: true },
  error: { type: String, default: "" },
});
</script>
<template>
  <div class="form-stack">
    <p>使用紫薇统一账号登录，工作区权限由管理员分配。</p>
    <div v-if="error" class="auth-error" role="alert">{{ error }}</div>
    <a
      class="ziwei-button ziwei-button--primary ziwei-button--md"
      :href="loginUrl"
      >使用统一账号登录</a
    >
  </div>
</template>
