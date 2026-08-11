#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

typedef NS_ENUM(NSInteger, PoplurPerformanceMode) {
  PoplurPerformanceModeFull = 0,
  PoplurPerformanceModeReduced = 1,
  PoplurPerformanceModeLowPower = 2,
  PoplurPerformanceModeEmergency = 3,
};

@class PoplurPerformanceManager;

@protocol PoplurPerformanceObserver <NSObject>
- (void)poplurPerformanceManagerDidChange:(PoplurPerformanceManager *)manager;
@end

@interface PoplurPerformanceManager : NSObject

@property (nonatomic, readonly) PoplurPerformanceMode mode;
@property (nonatomic, readonly) NSInteger targetFramesPerSecond;
@property (nonatomic, readonly) CGFloat particleDensityMultiplier;
@property (nonatomic, readonly) BOOL particlesAllowed;
@property (nonatomic, readonly) BOOL appActive;
@property (nonatomic, readonly) NSUInteger memoryWarningCount;
@property (nonatomic, readonly) NSUInteger baseCacheBudgetBytes;

+ (instancetype)sharedManager;
- (void)addObserver:(id<PoplurPerformanceObserver>)observer;
- (void)removeObserver:(id<PoplurPerformanceObserver>)observer;
- (BOOL)acquireHeavyRenderer:(id)renderer identifier:(NSString *)identifier decorative:(BOOL)decorative;
- (void)releaseHeavyRenderer:(id)renderer;
- (NSDictionary<NSString *, id> *)stateDictionary;

@end
