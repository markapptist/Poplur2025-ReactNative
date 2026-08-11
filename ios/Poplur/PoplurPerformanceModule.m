#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import "PoplurPerformanceManager.h"

@interface PoplurPerformanceNative : RCTEventEmitter <RCTBridgeModule, PoplurPerformanceObserver>
@end

@implementation PoplurPerformanceNative {
  BOOL _observing;
}

RCT_EXPORT_MODULE(PoplurPerformanceNative)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"PoplurPerformanceDidChange"];
}

- (void)startObserving
{
  _observing = YES;
  [[PoplurPerformanceManager sharedManager] addObserver:self];
}

- (void)stopObserving
{
  _observing = NO;
  [[PoplurPerformanceManager sharedManager] removeObserver:self];
}

- (void)invalidate
{
  [self stopObserving];
  [super invalidate];
}

RCT_REMAP_METHOD(getCurrentState,
                 getCurrentStateWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve([[PoplurPerformanceManager sharedManager] stateDictionary]);
  });
}

- (void)poplurPerformanceManagerDidChange:(PoplurPerformanceManager *)manager
{
  if (_observing) [self sendEventWithName:@"PoplurPerformanceDidChange" body:manager.stateDictionary];
}

@end
