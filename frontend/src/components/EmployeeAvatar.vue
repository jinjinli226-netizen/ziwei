<script setup>
import {computed} from 'vue';
import {employeeAvatarSrc,isCharacterAvatar} from '../../../src/employee-avatar.mjs';

const props=defineProps({avatar:{type:String,default:null},name:{type:String,default:''},identity:{type:String,default:''},alt:{type:String,default:''}});
const character=computed(()=>!props.avatar||isCharacterAvatar(props.avatar));
const source=computed(()=>employeeAvatarSrc(props.avatar,props.identity||props.name||'employee'));
</script>

<template>
  <span class="employee-avatar" :class="{'employee-avatar--character':character}" :style="character?{background:'transparent'}:undefined">
    <img :src="source" :alt="alt" :data-avatar-kind="character?'character':'image'"/>
    <slot/>
  </span>
</template>

<style>
:where(.employee-avatar){position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:38px;height:38px;vertical-align:middle;overflow:visible;border-radius:inherit}
.employee-avatar>img{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.employee-avatar--character>img{object-fit:contain}
</style>
