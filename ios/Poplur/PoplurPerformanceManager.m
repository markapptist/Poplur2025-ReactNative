#import "PoplurPerformanceManager.h"

static NSUInteger const PoplurMiB = 1024 * 1024;

@interface PoplurPerformanceManager ()
@property (nonatomic, readwrite) PoplurPerformanceMode mode;
@property (nonatomic, readwrite) NSInteger targetFramesPerSecond;
@property (nonatomic, readwrite) CGFloat particleDensityMultiplier;
@property (nonatomic, readwrite) BOOL particlesAllowed;
@property (nonatomic, readwrite) BOOL appActive;
@property (nonatomic, readwrite) NSUInteger memoryWarningCount;
@property (nonatomic, readwrite) NSUInteger baseCacheBudgetBytes;
@end

@implementation PoplurPerformanceManager {
  NSHashTable<id<PoplurPerformanceObserver>> *_observers;
  __weak id _activeHeavyRenderer;
  NSString *_activeHeavyRendererIdentifier;
  NSString *_memoryPressure;
  NSUInteger _memoryPressureGeneration;
}

+ (instancetype)sharedManager
{
  static PoplurPerformanceManager *manager;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    manager = [[PoplurPerformanceManager alloc] initPrivate];
  });
  return manager;
}

- (instancetype)init
{
  return [PoplurPerformanceManager sharedManager];
}

- (instancetype)initPrivate
{
  if ((self = [super init])) {
    _observers = [NSHashTable weakObjectsHashTable];
    _memoryPressure = @"normal";
    _appActive = UIApplication.sharedApplication.applicationState == UIApplicationStateActive;
    uint64_t physicalMemory = NSProcessInfo.processInfo.physicalMemory;
    if (physicalMemory <= 3ULL * 1024ULL * PoplurMiB) {
      _baseCacheBudgetBytes = 150 * PoplurMiB;
    } else if (physicalMemory <= 6ULL * 1024ULL * PoplurMiB) {
      _baseCacheBudgetBytes = 300 * PoplurMiB;
    } else {
      _baseCacheBudgetBytes = 450 * PoplurMiB;
    }

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(systemStateChanged:) name:NSProcessInfoThermalStateDidChangeNotification object:nil];
    [center addObserver:self selector:@selector(systemStateChanged:) name:NSProcessInfoPowerStateDidChangeNotification object:nil];
    [center addObserver:self selector:@selector(applicationBecameActive:) name:UIApplicationDidBecomeActiveNotification object:nil];
    [center addObserver:self selector:@selector(applicationResignedActive:) name:UIApplicationWillResignActiveNotification object:nil];
    [center addObserver:self selector:@selector(applicationResignedActive:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [center addObserver:self selector:@selector(memoryWarning:) name:UIApplicationDidReceiveMemoryWarningNotification object:nil];
    [self recomputeModeAndNotify:NO];
  }
  return self;
}

- (void)dealloc
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)addObserver:(id<PoplurPerformanceObserver>)observer
{
  NSAssert(NSThread.isMainThread, @"Poplur performance observers must be managed on the main thread");
  [_observers addObject:observer];
}

- (void)removeObserver:(id<PoplurPerformanceObserver>)observer
{
  [_observers removeObject:observer];
}

- (BOOL)acquireHeavyRenderer:(id)renderer identifier:(NSString *)identifier decorative:(BOOL)decorative
{
  if (!renderer || !self.appActive || (decorative && self.mode == PoplurPerformanceModeEmergency)) {
    return NO;
  }
  if (_activeHeavyRenderer && _activeHeavyRenderer != renderer) {
    return NO;
  }
  _activeHeavyRenderer = renderer;
  _activeHeavyRendererIdentifier = [identifier copy];
  return YES;
}

- (void)releaseHeavyRenderer:(id)renderer
{
  if (_activeHeavyRenderer != renderer) return;
  _activeHeavyRenderer = nil;
  _activeHeavyRendererIdentifier = nil;
  [self notifyObservers];
}

- (void)systemStateChanged:(NSNotification *)notification
{
  [self recomputeModeAndNotify:YES];
}

- (void)applicationBecameActive:(NSNotification *)notification
{
  self.appActive = YES;
  [self recomputeModeAndNotify:YES];
}

- (void)applicationResignedActive:(NSNotification *)notification
{
  self.appActive = NO;
  _activeHeavyRenderer = nil;
  _activeHeavyRendererIdentifier = nil;
  [self notifyObservers];
}

- (void)memoryWarning:(NSNotification *)notification
{
  self.memoryWarningCount += 1;
  _memoryPressure = @"critical";
  NSUInteger generation = ++_memoryPressureGeneration;
  [self recomputeModeAndNotify:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (self->_memoryPressureGeneration != generation) return;
    self->_memoryPressure = @"normal";
    [self recomputeModeAndNotify:YES];
  });
}

- (void)recomputeModeAndNotify:(BOOL)notify
{
  PoplurPerformanceMode nextMode = PoplurPerformanceModeFull;
  switch (NSProcessInfo.processInfo.thermalState) {
    case NSProcessInfoThermalStateFair:
      nextMode = PoplurPerformanceModeReduced;
      break;
    case NSProcessInfoThermalStateSerious:
      nextMode = PoplurPerformanceModeLowPower;
      break;
    case NSProcessInfoThermalStateCritical:
      nextMode = PoplurPerformanceModeEmergency;
      break;
    default:
      break;
  }
  if (NSProcessInfo.processInfo.lowPowerModeEnabled) {
    nextMode = MAX(nextMode, PoplurPerformanceModeLowPower);
  }
  if ([_memoryPressure isEqualToString:@"critical"]) {
    nextMode = PoplurPerformanceModeEmergency;
  }
  PoplurPerformanceMode previousMode = self.mode;
  self.mode = nextMode;
  switch (nextMode) {
    case PoplurPerformanceModeReduced:
      self.targetFramesPerSecond = 24;
      self.particleDensityMultiplier = 0.5;
      self.particlesAllowed = YES;
      break;
    case PoplurPerformanceModeLowPower:
      self.targetFramesPerSecond = 15;
      self.particleDensityMultiplier = 0.25;
      self.particlesAllowed = YES;
      break;
    case PoplurPerformanceModeEmergency:
      self.targetFramesPerSecond = 10;
      self.particleDensityMultiplier = 0;
      self.particlesAllowed = NO;
      _activeHeavyRenderer = nil;
      _activeHeavyRendererIdentifier = nil;
      break;
    default:
      self.targetFramesPerSecond = 30;
      self.particleDensityMultiplier = 1;
      self.particlesAllowed = YES;
      break;
  }
#if DEBUG
  if (previousMode != nextMode) {
    NSLog(@"[PoplurPerformance] Mode changed %@ -> %@", [self nameForMode:previousMode], [self nameForMode:nextMode]);
  }
#endif
  if (notify) [self notifyObservers];
}

- (void)notifyObservers
{
  if (!NSThread.isMainThread) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self notifyObservers]; });
    return;
  }
  for (id<PoplurPerformanceObserver> observer in _observers.allObjects) {
    [observer poplurPerformanceManagerDidChange:self];
  }
}

- (NSString *)nameForMode:(PoplurPerformanceMode)mode
{
  switch (mode) {
    case PoplurPerformanceModeReduced: return @"REDUCED";
    case PoplurPerformanceModeLowPower: return @"LOW_POWER";
    case PoplurPerformanceModeEmergency: return @"EMERGENCY";
    default: return @"FULL";
  }
}

- (NSString *)thermalName
{
  switch (NSProcessInfo.processInfo.thermalState) {
    case NSProcessInfoThermalStateFair: return @"fair";
    case NSProcessInfoThermalStateSerious: return @"serious";
    case NSProcessInfoThermalStateCritical: return @"critical";
    default: return @"nominal";
  }
}

- (NSDictionary<NSString *,id> *)stateDictionary
{
  return @{
    @"mode": [self nameForMode:self.mode],
    @"thermalState": [self thermalName],
    @"lowPowerMode": @(NSProcessInfo.processInfo.lowPowerModeEnabled),
    @"memoryPressure": _memoryPressure,
    @"memoryWarningCount": @(self.memoryWarningCount),
    @"appActive": @(self.appActive),
    @"targetFPS": @(self.targetFramesPerSecond),
    @"particleDensityMultiplier": @(self.particleDensityMultiplier),
    @"cacheBudgetBytes": @(self.baseCacheBudgetBytes),
    @"activeHeavyRendererCount": @(_activeHeavyRenderer ? 1 : 0),
    @"activeHeavyRenderer": _activeHeavyRendererIdentifier ?: [NSNull null],
  };
}

@end
