import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import {
  normalizePoplurBrowserUrl,
  resolvePoplurBrowserTargetUrl,
  shouldAllowPoplurBrowserRequest,
} from '../services/inAppBrowser';
import type {
  PoplurBrowserNavigationState,
  PoplurBrowserWebSurfaceHandle,
  PoplurBrowserWebSurfaceProps,
} from './PoplurBrowserWebSurfaceTypes';

const DENY_EXTERNAL_DEVICE_ACCESS = `;(function(){
  var permissionError=Object.freeze({code:1,PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3,message:'Permission denied by Poplur Browser'});
  function fail(callback){if(typeof callback==='function')setTimeout(function(){callback(permissionError);},0);}
  var blockedGeolocation=Object.freeze({
    getCurrentPosition:function(success,error){fail(error);},
    watchPosition:function(success,error){fail(error);return 0;},
    clearWatch:function(){}
  });
  try{Object.defineProperty(Navigator.prototype,'geolocation',{get:function(){return blockedGeolocation;},enumerable:true,configurable:false});}catch(_){}
  try{Object.defineProperty(navigator,'geolocation',{value:blockedGeolocation,writable:false,configurable:false});}catch(_){}
  function denied(){return Promise.resolve('denied');}
  ['DeviceMotionEvent','DeviceOrientationEvent','DeviceOrientationEventAbsolute'].forEach(function(name){
    try{var ctor=window[name];if(ctor){Object.defineProperty(ctor,'requestPermission',{value:denied,writable:false,configurable:false});Object.defineProperty(window,name,{value:ctor,writable:false,configurable:false});}}catch(_){}
  });
  ['Accelerometer','Gyroscope','Magnetometer','AbsoluteOrientationSensor','RelativeOrientationSensor'].forEach(function(name){
    try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});}catch(_){}
  });
  try{
    var nativeAdd=EventTarget.prototype.addEventListener;
    Object.defineProperty(EventTarget.prototype,'addEventListener',{value:function(type,listener,options){
      if(type==='devicemotion'||type==='deviceorientation'||type==='deviceorientationabsolute')return;
      return nativeAdd.call(this,type,listener,options);
    },writable:false,configurable:false});
  }catch(_){}
  ['ondevicemotion','ondeviceorientation','ondeviceorientationabsolute'].forEach(function(name){
    try{Object.defineProperty(window,name,{value:null,writable:false,configurable:false});}catch(_){}
  });
})();true;`;

export const PoplurBrowserWebSurface = forwardRef<
  PoplurBrowserWebSurfaceHandle,
  PoplurBrowserWebSurfaceProps
>(function PoplurBrowserWebSurface({ url, onNavigationStateChange }, forwardedRef) {
  const webViewRef = useRef<WebView>(null);
  const lastStateRef = useRef<PoplurBrowserNavigationState>({
    url,
    canGoBack: false,
    loading: true,
    failed: false,
  });

  const updateState = useCallback((next: PoplurBrowserNavigationState) => {
    lastStateRef.current = next;
    onNavigationStateChange(next);
  }, [onNavigationStateChange]);

  useImperativeHandle(forwardedRef, () => ({
    goBack: () => webViewRef.current?.goBack(),
    stopLoading: () => webViewRef.current?.stopLoading(),
  }), []);

  const handleNavigation = useCallback((navigation: WebViewNavigation) => {
    const allowedUrl = normalizePoplurBrowserUrl(navigation.url);
    if (!allowedUrl) return;
    updateState({
      url: allowedUrl,
      canGoBack: navigation.canGoBack,
      loading: navigation.loading,
      failed: false,
    });
  }, [updateState]);

  const fail = useCallback(() => {
    updateState({ ...lastStateRef.current, loading: false, failed: true });
  }, [updateState]);

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: url }}
      style={styles.webView}
      originWhitelist={['https://*']}
      onShouldStartLoadWithRequest={request => shouldAllowPoplurBrowserRequest(request.url)}
      onNavigationStateChange={handleNavigation}
      onOpenWindow={event => {
        const nextUrl = resolvePoplurBrowserTargetUrl(event.nativeEvent.targetUrl);
        if (!nextUrl) return;
        webViewRef.current?.injectJavaScript(
          `window.location.assign(${JSON.stringify(nextUrl)}); true;`,
        );
        updateState({
          ...lastStateRef.current,
          url: nextUrl,
          loading: true,
          failed: false,
        });
      }}
      onLoadStart={event => {
        const allowedUrl = normalizePoplurBrowserUrl(event.nativeEvent.url);
        if (!allowedUrl) return;
        updateState({
          ...lastStateRef.current,
          url: allowedUrl,
          loading: true,
          failed: false,
        });
      }}
      onLoadEnd={() => updateState({ ...lastStateRef.current, loading: false })}
      onError={fail}
      onContentProcessDidTerminate={fail}
      // iOS uses a non-persistent data store and explicitly denies web media.
      // Android never renders this file: its platform implementation is a
      // native WebView whose WebChromeClient denies every permission request.
      incognito
      cacheEnabled={false}
      sharedCookiesEnabled={false}
      injectedJavaScriptBeforeContentLoaded={DENY_EXTERNAL_DEVICE_ACCESS}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      allowsInlineMediaPlayback={false}
      mediaCapturePermissionGrantType="deny"
      allowsLinkPreview={false}
      applicationNameForUserAgent="PoplurBrowser/1.0"
    />
  );
});

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
